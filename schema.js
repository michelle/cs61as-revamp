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
var Progress;

/** Default permissions set. */
var permissions = {
  SuperAdmin: 0x1FFFFF,
  Instructor: 0x1FFC4F,
  Grader: 0x1FFC07,
  User: 0x1FC006,
  Guest: 0x000004
};

/** @return a random string that can be used as salt or token. */
function randomToken() {
  return String(Math.round(new Date().valueOf() * Math.random()));
};

/** Defines schemas for different collections. */
function defineModels(mongoose, fn) {
  var Schema = mongoose.Schema;
  var ObjectId = Schema.ObjectId;

  /** An announcement. */
  Announcement = new Schema({
    title: {
      type: String,
      required: true
    },
    content: {
      type: String,
      required: true
    },
    date: {
      type: Date,
      default: new Date(),
      required: true
    }
  });

  /** A reading.
   *  location: a relative link to a reading assignment.
   *  if SICP, an absolute link to SICP page. */
  // TODO: maybe we don't need SCIP flag.
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
  /** Attach a progress. */
  Reading.method('attachProgress', function(set, get) {
    this._set = set;
    this._get = get;
  });
  /** isCompleted. */
  Reading.virtual('isCompleted').set(function(value) {
    this._set(value);
  }).get(function() {
    return this._get();
  });
  
  /** A video.
   *  url: youtube video id. */
  Video = new Schema({
    name: {
      type: String,
      required: true
    },
    url: {
      type: String,
      required: true
    }
  });
  /** Attach a progress. */
  Video.method('attachProgress', function(set, get) {
    this._set = set;
    this._get = get;
  });
  /** isCompleted. */
  Video.virtual('isCompleted').set(function(value) {
    this._set(value);
  }).get(function() {
    return this._get();
  });

  /** A grade.
   *  Only entered grades are stored in the database. */
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
      required: true
    },
    weight: {
      type: Number,
      required: true
    }
  });

  /** An assignment.
   *  Only accessible through Lesson. */
  Assignment = new Schema({
    name: {
      type: String,
      required: true
    }
  });
  /** Attach a progress. */
  Assignment.method('attachProgress', function(set, get) {
    this._set = set;
    this._get = get;
  });
  /** isCompleted. */
  Assignment.virtual('isCompleted').set(function(value) {
    this._set(value);
  }).get(function() {
    return this._get();
  });

  /** A lesson. */
  Lesson = new Schema({
    number: {
      type: Number,
      min: 1,
      required: true,
      index: true
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
    extra: {
      type: [Assignment],
      'default': []
    },
    readings: {
      type: [Reading],
      'default': []
    },
  });
  Lesson.virtual('homework').get(function() {
    return this.assignments && this.assignments[0];
  });
  Lesson.virtual('project').get(function() {
    return this.assignments && this.assignments[1];
  });
  /** Attach a progress. */
  Lesson.method('attachProgress', function(get) {
    this._get = get;
  });
  Lesson.virtual('isCompleted').get(function() {
    return this._get[0];
  });

  Progress = new Schema({
    lesson: {
      type: ObjectId,
      ref: Lesson
    },
    user: {
      type: ObjectId,
      ref: User
    },
    videos: [{
      type: Boolean,
      'default': false
    }],
    assignments: [{
      type: Boolean,
      'default': false
    }],
    extra: [{
      type: Boolean,
      'default': false
    }],
    readings: [{
      type: Boolean,
      'default': false
    }],
  });
  Progress.index({ lesson: 1, user: 1 }, { unique: true });

  /** A user. */
  User = new Schema({
    email: {
      // TODO: regex email
      type: String,
      index: {
        unique: true
      }
    },
    username: {
      type: String,
      match: /^[a-z][a-z0-9_-]{2,31}$/i,
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
    currentLesson: {
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
      max: 5,
      'default': 2
    },
    salt: {
      type: String,
    }
  });

  /** Password conversion. */
  User.virtual('password').set(function(password) {
    this._password = password;
    this.salt = randomToken();
    this.hashed_password = this.encryptPassword(password);
  }).get(function() {
    return this._password;
  });
  /** Password authentication. */
  User.method('authenticate', function(plainText) {
    return this.encryptPassword(plainText) === this.hashed_password;
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
  LoginToken = new Schema({
    username: {
      type: String,
      match: /^[a-z][a-z0-9_-]{2,31}$/i,
      required: true,
      index: {
        unique: true
      }
    },
    series: {
      type: String,
      index: true
    },
    token: {
      type: String,
    }
  });

  /** Automatically create the series when this is first created.
   *  Regenerate token every time user visits. */
  LoginToken.pre('save', function(next) {
    if (!this.series) {
      this.series = randomToken();
    }
    this.token = randomToken();
    next();
  });

  LoginToken.virtual('id').get(function() {
    return this._id.toHexString();
  });

  // TODO: encrypt cookie
  LoginToken.virtual('cookieValue').get(function() {
    return JSON.stringify({
      username: this.username,
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
  mongoose.model('Progress', Progress);
  mongoose.model('Announcement', Announcement);

  fn();
}

exports.defineModels = defineModels;
exports.permissions = permissions;
