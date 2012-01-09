/** Encryption dependencies. */
var crypto = require('crypto');

/** Database Models. */
var User;
var Grade;
var LoginToken;
var ConfirmationToken;
var Announcement;
var Ticket;
var Unit;
var Lesson;
var Reading;
var Video;
var Homework;
var Project;
var Extra;
var Progress;
var UnitProgress;

/** Default permissions set. */
var permissions = {
  SuperAdmin: 0x1FFFFF,
  Instructor: 0x1FFC4F,
  Grader: 0x1FFC07,
  Student: 0x1FC006,
  Guest: 0x000004
};

var emailRegEx = /^[a-z](?=[\w.]{1,31}@)\w*\.?\w*@(cs\.)*berkeley.edu$/i;
var emailRegExOptional = /^([a-z](?=[\w.]{1,31}@)\w*\.?\w*@(cs\.)*berkeley.edu)?$/i;
var usernameRegEx = /^[a-z][a-z0-9_-]{2,31}$/i;

/** @return a random string that can be used as salt or token. */
function randomToken() {
  return String(Math.round(new Date().valueOf() * Math.random()));
};

/** Defines schemas for different collections. */
function defineModels(mongoose, fn) {
  var Schema = mongoose.Schema;
  var ObjectId = Schema.ObjectId;
  
  /** A user. */
  User = new Schema({
    email: {
      type: String,
      index: {
        sparse: true,
        unique: true
      },
      match: emailRegExOptional
    },
    isEnable: {
      // TODO: required: true,
      type: Boolean
    },
    isActivated: {
      // TODO: required: true,
      type: Boolean
    },
    username: {
      type: String,
      match: usernameRegEx,
      required: true,
      index: {
        unique: true
      }
    },
    fullname: {
      // TODO: required: true
      // TODO: pattern
      type: String
    },
    permission: {
      type: Number,
      'enum': [permissions.SuperAdmin, permissions.Instructor, permissions.Student, permissions.Guest],
      'default': 0
    },
    currentUnit: {
      type: Number,
      min: 0,
      max: 5,
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
      min: 2,
      max: 5,
      'default': 2
    },
    grader: {
      type: ObjectId,
      ref: 'User'
    },
    salt: {
      type: String,
    }
  });
  /** Password conversion. */
  User.virtual('password').set(function(password) {
    this.salt = randomToken();
    this.hashed_password = this.encryptPassword(password);
  });
  /** Password authentication. */
  User.method('authenticate', function(plainText) {
    return this.encryptPassword(plainText) === this.hashed_password;
  });
  /** Password encryption. */
  User.method('encryptPassword', function(password) {
    return crypto.createHmac('sha1', this.salt).update(password).digest('hex');
  });
  User.statics.Permissions = permissions;
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
  User.virtual('isSuperAdmin').get(function() {
    return this.permission == permissions.SuperAdmin;
  });
  User.virtual('Instructor').get(function() {
    return this.permission == permissions.Instructor;
  });
  User.virtual('Grader').get(function() {
    return this.permission == permissions.Grader;
  });
  User.virtual('Student').get(function() {
    return this.permission == permissions.Student;
  });
  User.virtual('Guest').get(function() {
    return this.permission == permissions.Guest;
  });

  /** A grade, sorted by order.
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
      // TODO: regex for grade, --, number, maybe ABCDF, maybe pass/nopass?
      type: String,
      required: true
    },
    weight: {
      type: Number,
      required: true
    }
  });

  /** Login token for remembering logins. */
  LoginToken = new Schema({
    username: {
      type: String,
      match: usernameRegEx,
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
  // TODO: encrypt cookie
  LoginToken.virtual('cookieValue').get(function() {
    return JSON.stringify({
      username: this.username,
      token: this.token,
      series: this.series
    });
  });
  
  ConfirmationToken = new Schema({
    user: {
      type: ObjectId,
      ref: 'User',
      required: true
    },
    token: {
      type: String,
    },
    date: {
      type: Date,
      default: new Date(),
      required: true
    }
  });
  /** Automatically create the series when this is first created.
   *  Regenerate token every time user visits. */
  ConfirmationToken.pre('save', function(next) {
    this.token = randomToken();
    next();
  });

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
  Announcement.virtual('created').get(function() {
    return this.date.getMonth() + '/' + this.date.getDate();
  });

  /** Ticket to keep track of feedback. Status is true if open. */
  Ticket = new Schema({
    status: {
      type: Boolean,
      'default': true,
      required: true
    },
    subject: {
      type: String,
      required: true
    },
    complainer: {
      type: String,
      required: true
    },
    responder: {
      type: String,
      required: true
    },
    complaints: [{
      type: String,
      'default': []
    }],
    responses: [{
      type: String,
      'default': []
    }],
    date: {
      type: Date,
      'default': new Date()
    }
  });
  /** Determines whose turn it is to talk.*/
  Ticket.virtual('who').get(function() {
    if (this.responses.length > this.complaints.length) {
      return this.complainer;
    } else {
      return this.responder;
    }
  });

  /** A Unit.
   *  A Unit contains multiple lessons, and multiple projects.
   *  Project will appear on dashboard when a user comes pass a lessons threshold.  */
  Unit = new Schema({
    number: {
      type: Number,
      min: 0,
      max: 5,
      required: true,
      index: {
        unique: true
      }
    },
    name: {
      type: String,
      required: true
    },
    projects: [{
      type: ObjectId,
      ref: 'Project',
      'default': []
    }]
  });

  /** A lesson.
   *  one hw, one project, multiple extras, one intro, multiple note, multiple webcasts.  */
  Lesson = new Schema({
    number: {
      type: Number,
      min: 1,
      required: true,
      index: {
        unique: true
      }
    },
    name: {
      type: String,
      required: true
    },
    unit: {
      type: ObjectId,
      required: true,
      ref: 'Unit'
    },
    homework: {
      type: ObjectId,
      required: true,
      ref: 'Homework'
    },
    extra: [{
      type: ObjectId,
      ref: 'Extra',
      'default': []
    }],
    videos: [{
      type: ObjectId,
      ref: 'Video',
      'default': []
    }],
    readings: [{
      type: ObjectId,
      ref: 'Reading',
      'default': []
    }]
  });
  /** Only valid after populating progress .*/
  Lesson.virtual('isCompleted').get(function() {
    return this.homework.isCompleted;
  });
  /** Returns array of projects. */
  Lesson.virtual('projects').get(function() {
    return this.unit.projects;
  });

  /** A homework assignment.
   *  Only accessible through Lesson. */
  Homework = new Schema({
    name: {
      type: String,
      required: true
    }
  });
  /** Attach a progress. */
  Homework.method('attachProgress', function(set, get) {
    this._set = set;
    this._get = get;
  });
  /** isCompleted. */
  Homework.virtual('isCompleted').set(function(value) {
    this._set(value);
  }).get(function() {
    return this._get();
  });

  /** A project assignment.
   *  Only accessible through Lesson. */
  Project = new Schema({
    name: {
      type: String,
      required: true
    },
    projectLessonNumber: {
      type: Number,
      required: true
    }
  });
  /** Attach a progress. */
  Project.method('attachProgress', function(set, get) {
    this._set = set;
    this._get = get;
  });
  /** isCompleted. */
  Project.virtual('isCompleted').set(function(value) {
    this._set(value);
  }).get(function() {
    return this._get();
  });

  /** An extra for experts assignment.
   *  Only accessible through Lesson. */
  Extra = new Schema({
    name: {
      type: String,
      required: true
    }
  });
  /** Attach a progress. */
  Extra.method('attachProgress', function(set, get) {
    this._set = set;
    this._get = get;
  });
  /** isCompleted. */
  Extra.virtual('isCompleted').set(function(value) {
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

  /** A reading.
   *  location: a relative link to a reading assignment.
   *  if SICP, an absolute link to SICP page. */
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

  /** Progress to keep track of what a user has completed. */
  Progress = new Schema({
    lesson: {
      type: ObjectId,
      ref: 'Lesson'
    },
    user: {
      type: ObjectId,
      ref: 'User'
    },
    homework: {
      type: Boolean,
      'default': false
    },
    extra: [{
      type: Boolean,
      'default': []
    }],
    videos: [{
      type: Boolean,
      'default': []
    }],
    readings: [{
      type: Boolean,
      'default': []
    }]
  });
  Progress.index({ lesson: 1, user: 1 }, { unique: true });
  
  /** Progress to keep track of which projects a user has completed .*/
  UnitProgress = new Schema({
    unit: {
      type: ObjectId,
      ref: 'Unit'
    },
    user: {
      type: ObjectId,
      ref: 'User'
    },
    projects: [{
      type: Boolean,
      'default': []
    }]
  });
  UnitProgress.index({ unit: 1, user: 1 }, { unique: true });

  /** Set up models. */
  mongoose.model('User', User);
  mongoose.model('Grade', Grade);
  mongoose.model('LoginToken', LoginToken);
  mongoose.model('ConfirmationToken', LoginToken);
  mongoose.model('Announcement', Announcement);
  mongoose.model('Ticket', Ticket);
  mongoose.model('Unit', Unit);
  mongoose.model('Lesson', Lesson);
  mongoose.model('Reading', Reading);
  mongoose.model('Video', Video);
  mongoose.model('Homework', Homework);
  mongoose.model('Project', Project);
  mongoose.model('Extra', Extra);
  mongoose.model('Progress', Progress);
  mongoose.model('UnitProgress', UnitProgress);

  fn();
}

exports.defineModels = defineModels;
exports.emailRegEx = emailRegEx;
exports.usernameRegEx = usernameRegEx;
