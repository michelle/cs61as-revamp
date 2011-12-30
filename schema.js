/** Encryption dependencies. */
var crypto = require('crypto'),
    User,
    LoginToken,
    Reading,
    Video,
    Assignment,
    Lesson,
    Grade;
    
/** Defines schemas for different collections. */
function defineModels(mongoose, fn) {  
  var Schema = mongoose.Schema,
      ObjectId = Schema.ObjectId;
      
  function validatePresenceOf(value) {
    return value && value.length;
  }
  
  /** A reading. */
  Reading = new Schema( {
    name: String,
    location: String,
    SICP: {
      type: Boolean,
      default: false
    }
  });
  
  /** A video. */
  Video = new Schema( {
    name: String,
    url: String
  });
  
  /** A grade. */
  Grade = new Schema( {
    order: {
      type: String,
      index: { unique: true }
    },
    name: String,
    location: String,
    grade: {
      type: String,
      default: "--"
    }
  });

  /** An assignment. */
  Assignment = new Schema( {
    order: {
      type: String,
      index: { unique: true }
    },
    name: String,
    project: {
      type: Boolean,
      default: false
    },
    location: String
  });
  
  /** A lesson. */
  Lesson = new Schema( {
    number: {
      type: String,
      index: { unique: true }
    },
    name: String,
    videos: [Video],
    assignments: [Assignment],
    readings: [Reading]
  }); 

  /** A user. */
  User = new Schema( {
    email: {
      type: String,
      index: { unique: true }
    },
    username: {
      type: String,
      index: { unique: true }
    },
    progress: String,
    grades: [Grade],
    hashed_password: String,
    units: String,
    // TODO: Boolean values for each thing completed, reset upon lesson increment.
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
    return this.encryptPassword(plainText) === this.hashed_password;
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
  // TODO: Remember me feature using this. 
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
  mongoose.model('Lesson', Lesson);
  mongoose.model('Assignment', Assignment);
  mongoose.model('Reading', Reading);
  mongoose.model('Video', Video);
  mongoose.model('Grade', Grade);

  fn();
}

exports.defineModels = defineModels; 
