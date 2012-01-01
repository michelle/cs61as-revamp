/** Encryption dependencies. */
var crypto = require('crypto');

/** Database Models. */
var User;
var LoginToken;
var Reading;
var Video;
var Assignment;
var Lesson;
var Grade;

var permissions = {
  SuperAdmin: 0x1FFFFF,
  Instructor: 0x1FFC4F,
  User: 0x1FC006,
  Guest: 0x000004
};

/** Defines schemas for different collections. */
function defineModels(mongoose, fn) {
  var Schema = mongoose.Schema;
  var ObjectId = Schema.ObjectId;

  /** A reading. */
  Reading = new Schema({
    name: {
      type: String,
      required: true
    },
    location: {
      type: String,
      required: true
    },
    SICP: {
      type: Boolean,
      'default': false
    }
  });

  /** A video. */
  Video = new Schema({
    name: {
      type: String,
      required: true
    },
    url: {
      // TODO: regex url
      type: String,
      required: true
    }
  });

  /** A grade. */
  Grade = new Schema({
    order: {
      type: Number,
      min: 0,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    grade: {
      type: String,
      'default': "--"
    },
    location: {
      // TODO: regex url
      type: String
    }
  });

  /** An assignment. */
  Assignment = new Schema({
    order: {
      type: Number,
      min: 0,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    project: {
      type: Boolean,
      'default': false
    }/**,
     location: {
     // TODO: regex url
     type: String
     }*/
    // Location is not needed because if project == true, will be projects/#, and
    // if false, homework/#.
  });

  /** A lesson. */
  Lesson = new Schema({
    number: {
      type: Number,
      min: 1,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    videos: {
      type: [Video],
      'default': []
    },
    assignments: {
      type: [Assignment],
      'default': []
    },
    readings: {
      type: [Reading],
      'default': []
    },
  });

  /** A user. */
  User = new Schema({
    email: {
      // TODO: regex email
      type: String,
      required: true,
      index: {
        unique: true
      }
    },
    username: {
      // TODO: regex username
      type: String,
      required: true,
      index: {
        unique: true
      }
    },
    permission: {
      type: Number,
      'enum': [permissions.SuperAdmin, permissions.Instructor, permissions.User, permissions.Guest],
      'default': 0
    },
    progress: {
      type: Number,
      min: 1,
      'default': 1
    },
    grades: {
      type: [Grade],
      'default': []
    },
    hashed_password: {
      type: String,
      required: true
    },
    units: {
      type: Number,
      min: 1,
      'default': 1
    },
    // TODO: Boolean values for each thing completed, reset upon lesson
    // increment.
    salt: {
      type: String,
      required: true
    }
  });

  /** Password conversion. */
  User.virtual('password').set(function(password) {
    this._password = password;
    this.salt = this.makeSalt();
    this.hashed_password = this.encryptPassword(password);
  }).get(function() {
    return this._password;
  });
  /** Password authentication. */
  User.method('authenticate', function(plainText) {
    return this.encryptPassword(plainText) === this.hashed_password;
  });

  User.method('makeSalt', function() {
    return String(Math.round(new Date().valueOf() * Math.random()));
  });
  /** Password encryption. */
  User.method('encryptPassword', function(password) {
    return crypto.createHmac('sha1', this.salt).update(password).digest('hex');
  });
  /** Permission helpers. */
  User.method('canAccessAdminPanel', function() {
    return this.permission & (1 << 0);
  });
  User.method('canAccessDashboard', function() {
    return this.permission & (1 << 1);
  });
  User.method('canReadLesson', function() {
    return this.permission & (1 << 2);
  });
  User.method('canWriteLesson', function() {
    return this.permission & (1 << 3);
  });
  User.method('canReadPermissionEveryone', function() {
    return this.permission & (1 << 4);
  });
  User.method('canWritePermissionEveryone', function() {
    return this.permission & (1 << 5);
  });
  User.method('canResetPaswordEveryone', function() {
    return this.permission & (1 << 6);
  });
  User.method('canWritePasswordEveryone', function() {
    return this.permission & (1 << 7);
  });
  User.method('canReadUserInfoEveryone', function() {
    return this.permission & (1 << 8);
  });
  User.method('canWriteUserInfoEveryone', function() {
    return this.permission & (1 << 9);
  });
  User.method('canReadGradeEveryone', function() {
    return this.permission & (1 << 10);
  });
  User.method('canWriteGradeEveryone', function() {
    return this.permission & (1 << 11);
  });
  User.method('canReadProgressEveryone', function() {
    return this.permission & (1 << 12);
  });
  User.method('canWriteProgressEveryone', function() {
    return this.permission & (1 << 13);
  });
  User.method('canResetPassword', function() {
    return this.permission & (1 << 14);
  });
  User.method('canWritePassword', function() {
    return this.permission & (1 << 15);
  });
  User.method('canReadUserInfo', function() {
    return this.permission & (1 << 16);
  });
  User.method('canWriteUserInfo', function() {
    return this.permission & (1 << 17);
  });
  User.method('canReadGrade', function() {
    return this.permission & (1 << 18);
  });
  User.method('canReadProgress', function() {
    return this.permission & (1 << 19);
  });
  User.method('canWriteProgress', function() {
    return this.permission & (1 << 20);
  });
  /** Login token for remembering logins. */
  // TODO: "Remember me" feature using this.
  LoginToken = new Schema({
    email: {
      // TODO: regex email
      type: String,
      index: true
    },
    series: {
      type: String,
      required: true,
      index: true
    },
    token: {
      type: String,
      required: true,
      index: true
    }
  });

  LoginToken.method('randomToken', function() {
    return String(Math.round(new Date().valueOf() * Math.random()));
  });

  LoginToken.pre('save', function(next) {
    // Automatically create the tokens
    this.token = this.randomToken();
    this.series = this.randomToken();
    next();
  });

  LoginToken.virtual('id').get(function() {
    return this._id.toHexString();
  });

  LoginToken.virtual('cookieValue').get(function() {
    return JSON.stringify({
      email: this.email,
      token: this.token,
      series: this.series
    });
  });
  /** Set up models. */
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
exports.permissions = permissions;
