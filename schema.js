/** Encryption dependencies. */
var crypto = require('crypto'),
    User,
    LoginToken;
    
/** Defines schema for a generic user, token. */
function defineModels(mongoose, fn) {  
  var Schema = mongoose.Schema,
      ObjectId = Schema.ObjectId;
      
  function validatePresenceOf(value) {
    return value && value.length;
  }

  /** A user. */
  User = new Schema({
    email: {
      type: String,
      index: { unique: true }
    },
    username: {
      type: String,
      index: { unique: true }
    },
    progress: String,
    grades: {},
    hashed_password: String,
    salt: String
  });

  /** Password conversion. */
  User.virtual('password')
    .set(function(password) {
      this._password = password;
      this.salt = this.makeSalt();
      this.hashed_password = this.encryptPassword(password);
    })
    .get(function() { return this._password; });

  /** Password authentication. */
  User.method('authenticate', function(plainText) {
    // TODO: ACTUALLY ENCRYPT...
    //return this.encryptPassword(plainText) === this.hashed_password;
    return plainText === this.hashed_password;
  });
  
  User.method('makeSalt', function() {
    return Math.round((new Date().valueOf() * Math.random())) + '';
  });
  
  /** Password encryption. */
  User.method('encryptPassword', function(password) {
    return crypto.createHmac('sha1', this.salt).update(password).digest('hex');
  });

  User.pre('save', function(next) {
    if (!validatePresenceOf(this.password)) {
      next(new Error('Invalid password'));
    } else {
      next();
    }
  });

  /** Login token for remembering logins. */
  LoginToken = new Schema({
    email: { type: String, index: true },
    series: { type: String, index: true },
    token: { type: String, index: true }
  });

  LoginToken.method('randomToken', function() {
    return Math.round((new Date().valueOf() * Math.random())) + '';
  });

  LoginToken.pre('save', function(next) {
    // Automatically create the tokens
    this.token = this.randomToken();
    this.series = this.randomToken();
    next();
  });

  LoginToken.virtual('id')
    .get(function() {
      return this._id.toHexString();
    });

  LoginToken.virtual('cookieValue')
    .get(function() {
      return JSON.stringify({ email: this.email, token: this.token, series: this.series });
    });

  mongoose.model('User', User);
  mongoose.model('LoginToken', LoginToken);

  fn();
}

exports.defineModels = defineModels; 
