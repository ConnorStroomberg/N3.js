// **N3Writer** writes N3 documents.

// Matches a literal as represented in memory by the N3 library
var N3LiteralMatcher = /^"([^]*)"(?:\^\^(.+)|@([\-a-z]+))?$/i;

// rdf:type predicate (for 'a' abbreviation)
var RDF_PREFIX = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
    RDF_TYPE   = RDF_PREFIX + 'type';

// Characters in literals that require escaping
var literalEscape    = /["\\\t\n\r\b\f]/,
    literalEscapeAll = /["\\\t\n\r\b\f]/g,
    literalReplacements = { '\\': '\\\\', '"': '\\"', '\t': '\\t',
                            '\n': '\\n', '\r': '\\r', '\b': '\\b', '\f': '\\f' };

// ## Constructor
function N3Writer(outputStream, prefixes) {
  if (!(this instanceof N3Writer))
    return new N3Writer(outputStream, prefixes);

  // Shift arguments if the first argument is not a stream
  if (outputStream && typeof outputStream.write !== 'function')
    prefixes = outputStream, outputStream = null;

  // If no output stream given, send the output as string through the end callback
  if (!outputStream) {
    outputStream = this;
    this._output = '';
    this.write = function (chunk, encoding, callback) {
      this._output += chunk;
      callback && callback();
    };
  }

  this._outputStream = outputStream;
  this._prefixURIs = Object.create(null);
  if (prefixes)
    this.addPrefixes(prefixes);
}

N3Writer.prototype = {
  // ## Private methods

  // ### `_write` writes the arguments to the output stream (last argument is callback)
  _write: function () {
    for (var i = 0, l = arguments.length - 2; i <= l; i++)
      this._outputStream.write(arguments[i], 'utf8', i === l ? arguments[l + 1] : null);
  },

  // ### `_writeUriOrBlankNode` writes a URI or blank node to the output stream
  _writeUriOrBlankNode: function (uri, done) {
    // Write blank node
    if (uri[0] === '_' && uri[1] === ':')
      return this._write(uri, done);

    // Write prefixed name if possible
    var prefixMatch = this._prefixRegex.exec(uri);
    if (prefixMatch)
      this._write(this._prefixURIs[prefixMatch[1]], prefixMatch[2], done);
    // Otherwise, just write the URI
    else
      this._write('<', uri, '>', done);
  },

  // ### `_writeLiteral` writes a literal to the output stream
  _writeLiteral: function (value, type, language, done) {
    // Escape the literal if necessary
    if (literalEscape.test(value)) {
      value = value.replace(literalEscapeAll, function (match) {
        return literalReplacements[match];
      });
    }

    // Write the literal, possibly with type or language
    this._write('"', value, '"', type || language ? null : done);
    if (type) {
      this._write('^^', null);
      this._writeUriOrBlankNode(type, done);
    }
    else if (language) {
      this._write('@', language, done);
    }
  },

  // ### `_writeSubject` writes a subject to the output stream
  _writeSubject: function (subject, done) {
    if (subject[0] === '"')
      throw new Error('A literal as subject is not allowed: ' + subject);
    this._writeUriOrBlankNode(subject, done);
  },

  // ### `_writePredicate` writes a predicate to the output stream
  _writePredicate: function (predicate, done) {
    if (predicate[0] === '"')
      throw new Error('A literal as predicate is not allowed: ' + predicate);
    if (predicate === RDF_TYPE)
      this._write('a', done);
    else
      this._writeUriOrBlankNode(predicate, done);
  },

  // ### `_writeObject` writes an object to the output stream
  _writeObject: function (object, done) {
    var literalMatch = N3LiteralMatcher.exec(object);
    if (literalMatch !== null)
      this._writeLiteral(literalMatch[1], literalMatch[2], literalMatch[3], done);
    else
      this._writeUriOrBlankNode(object, done);
  },

  // ### `_blockedWrite` replaces `_writer_ after the writer has been closed
  _blockedWrite: function () {
    throw new Error('Cannot write because the writer has been closed.');
  },

  // ### `addTriple` adds the triple to the output stream
  addTriple: function (subject, predicate, object, done) {
    // If the triple was given as a triple object, shift parameters
    if (!object) {
      done = predicate;
      object = subject.object;
      predicate = subject.predicate;
      subject = subject.subject;
    }
    // Write the triple
    try {
      // Don't repeat the subject if it's the same
      if (this._prevSubject === subject) {
        // Don't repeat the predicate if it's the same
        if (this._prevPredicate === predicate) {
          this._write(', ', null);
        }
        // Same subject, different predicate
        else {
          this._write(';\n    ', null);
          this._writePredicate(predicate);
          this._write(' ', null);

          this._prevPredicate = predicate;
        }
      }
      // Different subject; write the whole triple
      else {
        // End a possible previous triple
        if ('_prevSubject' in this)
          this._write('.\n', null);
        this._writeSubject(subject);
        this._write(' ', null);
        this._writePredicate(predicate);
        this._write(' ', null);

        this._prevSubject = subject;
        this._prevPredicate = predicate;
      }
      // In all cases, write the object
      this._writeObject(object, done);
    }
    catch (error) {
      done && done(error);
    }
  },

  // ### `addTriples` adds the triples to the output stream
  addTriples: function (triples) {
    for (var i = 0; i < triples.length; i++)
      this.addTriple(triples[i]);
  },

  // ### `addPrefix` adds the prefix to the output stream
  addPrefix: function (prefix, uri, done) {
    var prefixes = {};
    prefixes[prefix] = uri;
    this.addPrefixes(prefixes, done);
  },

  // ### `addPrefixes` adds the prefixes to the output stream
  addPrefixes: function (prefixes, done) {
    // Add all useful prefixes
    var hasPrefixes = false;
    for (var prefix in prefixes) {
      // Verify whether the prefix can be used and does not exist yet
      var uri = prefixes[prefix];
      if (/[#\/]$/.test(uri) && this._prefixURIs[uri] !== (prefix += ':')) {
        hasPrefixes = true;
        this._prefixURIs[uri] = prefix;
        // Finish a possible pending triple
        if ('_prevSubject' in this) {
          this._write('.\n', null);
          delete this._prevSubject;
        }
        // Write prefix
        this._write('@prefix ', prefix, ' <', uri, '>.\n', null);
      }
    }
    // Recreate the prefix matcher
    if (hasPrefixes) {
      var prefixURIs = '';
      for (var prefixURI in this._prefixURIs)
        prefixURIs += prefixURIs ? '|' + prefixURI : prefixURI;
      prefixURIs = prefixURIs.replace(/[\]\/\(\)\*\+\?\.\\\$]/g, '\\$&');
      this._prefixRegex = new RegExp('^(' + prefixURIs + ')([a-zA-Z][\\-_a-zA-Z0-9]*)$');
    }
    // End a prefix block with a newline
    this._write(hasPrefixes ? '\n' : '', done);
  },

  // ### `_prefixRegex` matches an URL that begins with one of the added prefixes
  _prefixRegex: { exec: function () { return null; } },

  // ### `end` signals the end of the output stream
  end: function (done) {
    // Finish a possible pending triple
    if ('_prevSubject' in this) {
      this._write('.\n', null);
      delete this._prevSubject;
    }
    // Disallow further writing
    this._write = this._blockedWrite;

    // If writing to a string instead of an actual stream, send the string
    if (this === this._outputStream)
      return done && done(null, this._output);

    // Try to end the underlying stream, ensuring done is called exactly one time
    var singleDone = done && function () { singleDone = null, done(); };
    // Ending a stream can error
    try { this._outputStream.end(singleDone); }
    // Execute the callback if it hasn't been executed
    catch (error) { singleDone && singleDone(); }
  },
};

// ## Exports

// Export the `N3Writer` class as a whole.
module.exports = N3Writer;
