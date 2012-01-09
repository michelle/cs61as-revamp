/** debug flags. */
var DEBUG_ERR = true;
var DEBUG_TRACE = true;
var DEBUG_USER = false;
var DEBUG_WARNING = true;
var FORCE_CRASH_ON_ERR = false;

/** option flags. */
var ENABLE_FLASH_ERR = true;
var ENABLE_SENDMAIL = true;
var ENABLE_GRADER_NOTIFICATION = false;
var ENABLE_FEEDBACK_NOTIFICATION = false;
var ENABLE_EMAIL_CONFIRMATION = true;

/** Default cookie lifetime is 1 day. */
var COOKIE_LIFETIME = 1000 * 60 * 60 * 24;
/** Default fav icon lifetime is 30 days. */
var FAVICON_LIFETIME = 1000 * 60 * 60 * 24 * 30

/** Setting up dependencies. */
var express = require('express');
var app = module.exports = express.createServer();
var mongoose = require('mongoose');
var mongoStore = require('connect-mongodb');
var schema = require('./schema.js');
var fs = require('fs');
var nodemailer = require('nodemailer');
var sanitizer = require('validator').sanitize;

/** Database. */
var db;

/** Flash message support. */
app.helpers(require('./dh.js').helpers);
app.dynamicHelpers(require('./dh.js').dynamicHelpers);

/** Student database URI. */
app.set('db-uri', 'mongodb://admin:scheme@staff.mongohq.com:10082/cs61as');

/** Database models. */
schema.defineModels(mongoose, function() {
  app.User = User = mongoose.model('User');
  app.Grade = Grade = mongoose.model('Grade');
  app.LoginToken = LoginToken = mongoose.model('LoginToken');
  app.ConfirmationToken = ConfirmationToken = mongoose.model('ConfirmationToken');
  app.Announcement = Announcement = mongoose.model('Announcement');
  app.Ticket = Ticket = mongoose.model('Ticket');
  app.Unit = Unit = mongoose.model('Unit');
  app.Lesson = Lesson = mongoose.model('Lesson');
  app.Reading = Reading = mongoose.model('Reading');
  app.Video = Video = mongoose.model('Video');
  app.Homework = Homework = mongoose.model('Homework');
  app.Project = Project = mongoose.model('Project');
  app.Extra = Extra = mongoose.model('Extra');
  app.Progress = Progress = mongoose.model('Progress');
  app.UnitProgress = UnitProgress = mongoose.model('UnitProgress');
  db = mongoose.connect(app.set('db-uri'));
});

/** Set up server, session management. */
app.use(express.favicon(__dirname + '/public/favicon.ico', {
  maxAge: FAVICON_LIFETIME
}));
app.use(express.bodyParser());
app.use(express.cookieParser());
app.use(express.session({
  secret: 'this sucks',
  store: mongoStore(db)
}));
app.use(express.static(__dirname + '/public'));

app.use(loadUser);
if (DEBUG_USER) {
  app.use(logUser);
}
app.use(checkUser);
app.use(validator);

app.use(app.router);
app.use(express.errorHandler({
  showStack: true,
  dumpExceptions: true
}));

/** Where to look for templates. */
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

/** Default unauthenticated user. */
var GUEST = new User({
  username: 'Guest',
  permission: User.Permissions.Guest,
  isEnable: true,
  isActivated: true
});

/** setting up SMTP information. */
if (ENABLE_SENDMAIL) {
  var config = JSON.parse(fs.readFileSync('conf/smtp.conf'));
  nodemailer.SMTP = config.SMTP;
}

/** Log OBJ to console bases on the type of OBJ and debug flags.*/
function log(obj) {
  if (obj) {
    if (obj instanceof Error) {
      if (DEBUG_ERR) {
        console.log(obj);
        if (FORCE_CRASH_ON_ERR) {
          app.exit(1);
        }
      }
    } else {
      if (DEBUG_WARNING) {
        console.log(obj);
      }
    }
  }
}

/** flash all the errors message in ERR. */
function flashErr(req, err) {
  if (ENABLE_FLASH_ERR) {
    for (var e in err.errors) {
      req.flash('error', err.errors[e].message);
    }
  }
}

/** Print a debug trace MSG.*/
function trace(msg) {
  if (DEBUG_TRACE && msg) {
    console.log('TRACE: %s', msg);
  }
}

/** My own middleware validator because express validator is so badly designed .*/
function validator(req, res, next) {
  req.sanitize = function(obj, prop, op) {
    req.body[obj][prop] = sanitizer(req.body[obj][prop])[op]().trim();
  };
  next();
}

/** Determine permissions. */
function getType(type) {
  switch(type) {
    case('Grader'):
      return User.Permissions.Grader;
    case('Student'):
      return User.Permissions.Student;
    case('Instructor'):
      return User.Permissions.Instructor;
    default:
      return User.Permissions.Guest;
  }
}

/** Load current user if logged in
 *  else set current user to GUEST. */
function loadUser(req, res, next) {
  trace('loadUser');
  req.currentUser = GUEST;
  if (req.session.user_id) {
    loadUserFromSession(req, res, next);
  } else {
    loadUserFromCookie(req, res, next);
  }
}


/** Attempt to load current user from session.
 *  Redirect to /home if session.user_id points to an invalid user. */
function loadUserFromSession(req, res, next) {
  User.findById(req.session.user_id).populate('grader').run(function(err, user) {
    trace('loadUserFromSession');
    log(err);
    if (user) {
      req.currentUser = user;
      next();
    } else {
      log('WARNING: Session tampering attempt detected: ' + req.session);
      res.clearCookie('rememberme');
      req.flash('info', 'Please login.');
      res.redirect('/home');
    }
  });
}

/** Attempt to load current user from cookie.
 *  Redirect to /home if cookie points to an invalid user. */
function loadUserFromCookie(req, res, next) {
  var cookie = req.cookies['rememberme'] && JSON.parse(req.cookies['rememberme']);
  if (!cookie || !cookie.username || !cookie.series || !cookie.token) {
    next();
    return;
  }
  trace('loadUserFromCookie');

  LoginToken.findOne({
    username: cookie.username,
    series: cookie.series
  }, function(err, token) {
    if (err) {
      log(err);
      return;
    }

    if (token) {
      if (token.token != cookie.token) {
        log('WARNING: Cookie tampering attempt detected for user: ' + cookie.username);
        LoginToken.remove({
          username: cookie.username
        }, function() {
          res.clearCookie('rememberme');
          req.flash('info', 'Please login.');
          res.redirect('/home');
        });
      } else {
        User.findOne({
          username: cookie.username
        }).populate('grader').run(function(err, user) {
          log(err);
          if (user) {
            req.currentUser = user;
            req.session.user_id = user._id;
            token.save(function(err){
              log(err);
              res.cookie('rememberme', token.cookieValue, { maxAge: COOKIE_LIFETIME });
              req.currentUser = user;
              next();
            });
          } else {
            next();
          }
        });
      }
    } else {
      res.clearCookie('rememberme');
      next();
    }
  });
}

/** Debug function, print out the currentUser .*/
function logUser(req, res, next) {
  trace('logUser');
  if (req.currentUser instanceof User) {
    console.log(req.currentUser);
  } else {
    console.log('ERROR: req.currentUser is not a User.')
  }
  next();
}
/** Check if the user has valid information. */
function checkUser(req, res, next) {
  trace('checkUser');
  res.local('currentUser', req.currentUser);
  if (!(/^(\/home|\/settings|\/login|\/logout|\/activate\/\w+\/\d+)$/.test(req.url))) {
    if (!req.currentUser.isEnable) {
      req.flash('info', "It looks like your account is disabled by an administrator. Please contact administrator.");
      res.clearCookie('rememberme');
      delete req.session.user_id;
      res.redirect('/home');
    } else if(!req.currentUser.isActivated) {
      req.flash('info', "It looks like you has not activated your account. Please enter your information below.");
      res.redirect('/settings');
    } else if (req.currentUser != GUEST
      && !(schema.emailRegEx.test(req.currentUser.email))) {
      req.flash('info', "It looks like you don't have a valid Berkeley email address. Please input a valid email to start.");
      res.redirect('/settings');
    } else {
      next();
    }
  } else {
    next();
  }
}
/** Set current lesson to the one specified by currentUser.currentLesson.
 *  Redirect to /home if currentUser.currentLesson points to an invalid lesson. */
function loadLesson(req, res, next) {
  trace('loadLesson');
  Lesson.findOne({
    number: req.currentUser.currentLesson
  }).populate('unit')
    .populate('homework')
    .populate('extra')
    .populate('videos')
    .populate('readings')
    .run(function(err, lesson) {
      log(err);
      req.currentLesson = !err && lesson;
      res.local('currentLesson', req.currentLesson);
      if (req.currentLesson) {
        Unit.findById(
          req.currentLesson.unit.id
        ).populate('projects')
          .run(function(err, unit) {
            log(err);
            req.currentUnit = !err && unit;
            res.local('currentUnit', req.currentUnit);
            next();
          });
      } else {
        req.currentUser.currentLesson = 1;
          req.currentUser.save(function(err) {
           log(err);
           log("WARNING: User " + req.currentUser.username + "'s currentLesson is corrupted: " + req.currentUser.currentLesson);
           req.flash('error', 'Looks like there is something wrong with your account. Please select one of the lesson below. If the problem persists, please contact administrators.');
           res.redirect('/lessons');
         });
      }
    });
}

/** Load current progress for current lesson and current user assuming that both exist.
 *  If there is no previous progress, create one. */
function loadProgress(req, res, next) {
  trace('loadProgress');
  if (!req.currentLesson) {
    next();
    return;
  }

  Progress.findOne({ lesson: req.currentLesson, user: req.currentUser }, function (err, progress) {
    log(err);
    UnitProgress.findOne({ unit: req.currentUnit, user: req.currentUser }, function (err, unitprogress) {
      log(err);
      if (!progress) {
        progress = new Progress({
          lesson: req.currentLesson,
          user: req.currentUser,
          homework: false,
          extra: req.currentLesson.extra.map(function (extra) { return false }),
          videos: req.currentLesson.videos.map(function (videos) { return false }),
          readings: req.currentLesson.readings.map(function (reading) { return false })
        });
        if (req.currentUser.canWriteProgress()) {
          progress.save(function (err){
            log(err);
          });
        }
      }
      if (!unitprogress) {
        unitprogress = new UnitProgress({
          unit: req.currentUnit,
          user: req.currentUser,
          projects: req.currentUnit.projects.map(function (project) { return false }),
        });
        if (req.currentUser.canWriteProgress()) {
          unitprogress.save(function (err){
            log(err);
          });
        }
      }
        
      req.currentLesson.homework.attachProgress(function(value) {
        if (req.currentUser.canWriteProgress()) {
          progress.homework = value;
          progress.markModified('homework');
          progress.save(function (err) {
            log(err);
          });
        }
      }, function() {
        return progress.homework;
      });
      for(var i = 0; i < req.currentLesson.extra.length; i++) {
        req.currentLesson.extra[i].attachProgress( function(id) {
          return function(value) {
            if (req.currentUser.canWriteProgress()) {
              progress.extra[id] = value;
              progress.markModified('extra');
              progress.save(function (err) {
                log(err);
              });
            }
          }
        }(i), function(id) {
          return function() {
            return progress.extra[id];
          }
        }(i));
      }
      for(var i = 0; i < req.currentLesson.videos.length; i++) {
        req.currentLesson.videos[i].attachProgress( function(id) {
          return function(value) {
            if (req.currentUser.canWriteProgress()) {
              progress.videos[id] = value;
              progress.markModified('videos');
              progress.save(function (err) {
                log(err);
              });
            }
          }
        }(i), function(id) {
          return function() {
            return progress.videos[id];
          }
        }(i));
      }
      for(var i = 0; i < req.currentLesson.readings.length; i++) {
        req.currentLesson.readings[i].attachProgress( function(id) {
          return function(value) {
            if (req.currentUser.canWriteProgress()) {
              progress.readings[id] = value;
              progress.markModified('readings');
              progress.save(function (err) {
                log(err);
              });
            }
          }
        }(i), function(id) {
          return function() {
            return progress.readings[id];
          }
        }(i));
      }
      for(var i = 0; i < req.currentUnit.projects.length; i++) {
        req.currentUnit.projects[i].attachProgress( function(id) {
          return function(value) {
            if (req.currentUser.canWriteProgress()) {
              unitprogress.projects[id] = value;
              unitprogress.markModified('projects');
              unitprogress.save(function (err) {
                log(err);
              });
            }
          }
        }(i), function(id) {
          return function() {
            return unitprogress.projects[id];
          }
        }(i));
      }
  
      next();
    });
  });
}

/** Make a middleware that only allows user with a PERMIT
 *  or if sameuser returns true.
 *  Redirect to /default if the user doesn't have the required permissions. */
function checkPermit(permit, sameuser) {
  return function(req, res, next) {
    trace('checkPermit: ' + permit);
    if (req.currentUser[permit]() || (sameuser && sameuser(req, res))) {
      next();
    } else {
      req.flash('error', 'Looks like you don\'t have the required permissions to access %s', req.url);
      res.redirect('/default');
    }
  }
}

/** An override to check if it's the same user base on IDENTIFICATION and PERMIT.
 *  Defaults method to check is username.
 *  Always return false for guest. */
function sameUser(permit, identification) {
  return function(req, res) {
    trace('sameUser');
    if (!identification) {
      identification = 'username';
    }
    return req.currentUser != GUEST && req.currentUser[identification] == req.params[identification] && req.currentUser[permit]();
  }
}

/** Feedback email. */
function sendFeedbackEmail(req, next) {
  if (!ENABLE_FEEDBACK_NOTIFICATION) {
    req.flash('info', "Feedback notification is not sent because option flag is off.");
    next();
    return;
  }
  var html = "User " + req.currentUser.username + " has submitted feedback concerning " + req.body.ticket.subject + ":<br/>" + req.body.ticket.complaint;
  var body = "User " + req.currentUser.username + " has submitted feedback concerning " + req.body.ticket.subject + ":\n" + req.body.ticket.complaint;
  var email = {
    sender: req.currentUser.email,
    to: req.currentUser.grader.email,
    subject: '[CS61AS] Feedback from student: ' + req.currentUser.username,
    html: html,
    body: body
  }
  sendMail(email, next);
}

/** Response to feedback email. */
function sendResponseEmail(req, next) {
  if (!ENABLE_FEEDBACK_NOTIFICATION) {
    req.flash('info', "Feedback notification is not sent because option flag is off.");
    next();
    return;
  }
  var html = req.currentUser.username + " has responded to your feedback concerning " + req.body.ticket.subject + ":<br/>" + req.body.ticket.response;
  var body = req.currentUser.username + " has responded to your feedback concerning " + req.body.ticket.subject + ":\n" + req.body.ticket.response;
  var emailjson = {
    sender: req.currentUser.email,
    to: req.body.ticket.complainer,
    subject: '[CS61AS] Response from instructor: ' + req.currentUser.username,
    html: html,
    body: body
  }
  sendMail(emailjson, next);
}
/** Grader email for Project. */
function sendGraderProjectNotification(req, next) {
  if (!ENABLE_GRADER_NOTIFICATION) {
    req.flash('info', "Grader notification is not sent because option flag is off.");
    next();
    return;
  }
  var html = "<p>You've received a grade request from " + req.currentUser.username
           + " regarding project " + req.project.name + " at "
           +  String(new Date())
           + ".<br /> If you received this email in error, please discard it immediately.</p>";
  var body = "You've received a grade request from " + req.currentUser.username
           + " regarding project " + req.project.name + " at "
           +  String(new Date())
           + ". If you received this email in error, please discard it immediately.";

  var email = {
    sender: 'astudent@somewhere.com',
    to: req.currentUser.grader.email,
    subject: '[CS61AS] Grade request (project) from student: ' + req.currentUser.username,
    html: html,
    body: body
  };
  sendMail(email, next);
}
/** Grader email for homework. */
function sendGraderNotification(req, next) {
  if (!ENABLE_GRADER_NOTIFICATION) {
    req.flash('info', "Grader notification is not sent because option flag is off.");
    next();
    return;
  }
  var html = "<p>You've received a grade request from " + req.currentUser.username
           + " regarding homework " + req.currentLesson.number + " at "
           +  String(new Date())
           + ".<br /> If you received this email in error, please discard it immediately.</p>";
  var body = "You've received a grade request from " + req.currentUser.username
           + " regarding homework " + req.currentLesson.number + " at "
           +  String(new Date())
           + ". If you received this email in error, please discard it immediately.";

  var email = {
    sender: 'astudent@somewhere.com',
    to: req.currentUser.grader.email,
    subject: '[CS61AS] Grade request (homework) from student: ' + req.currentUser.username,
    html: html,
    body: body
  };
  sendMail(email, next);
}
/** Email confirmation. */
function sendEmailConfirmation(req, token, next) {
  if (!ENABLE_EMAIL_CONFIRMATION) {
    req.flash('info', "Email notification is not sent because option flag is off.");
    next();
    return;
  }
  var html = "<p>You have requested an email change for class CS61AS at Berkely. "
           + "Please confirm this is your email by clicking at the following link.<br />"
           + "<a href='http://" + req.headers.host + "/activate/" + token.id + "/" + token.token + "'" + ">Activate</a>"
           + "<br />If you received this email in error, please discard it immediately.</p>";
  var body = "You have requested an email change for class CS61AS at Berkely. "
           + "Please confirm this is your email by clicking at the following link.\n"
           + "http://" + req.headers.host + "/activate/" + token.id + "/" + token.token
           + "\nIf you received this email in error, please discard it immediately.";

  var email = {
    sender: 'astudent@somewhere.com',
    to: req.currentUser.email,
    subject: '[CS61AS] Email confirmation: ' + req.currentUser.username,
    html: html,
    body: body
  };
  sendMail(email, next);
}
/** Generic mailer .*/
function sendMail(mail, next) {
  nodemailer.send_mail(mail, function(err, success) {
    if(err) {
      log(err);
      next(new Error("wrong smtp information"));
      return;
    }
    if(success) {
      next();
    } else {
      next(new Error("smtp server downs, or refuse to take our email."));
    }
  });
}
/** Pre condition param userId into req.user. */
app.param('userId', function(req, res, next, userId) {
  trace('param userId');
  User.findById(userId).populate('grader').run(function(err, user) {
    log(err);
    req.user = !err && user;
    next();
  });
});
/** Pre condition param username into req.user. */
app.param('username', function(req, res, next, username) {
  trace('param username');
  User.findOne({
    username: username
  }, function(err, user) {
    log(err);
    req.user = !err && user;
    next();
  });
});
/** Pre condition param ticketId into req.ticket. */
app.param('ticketId', function(req, res, next, ticketId) {
  trace('param ticketId');
  Ticket.findById(ticketId, function(err, ticket) {
    log(err);
    req.ticket = !err && ticket;
    next();
  });
});
/** Pre condition param tokenId into req.token. */
app.param('tokenId', function(req, res, next, tokenId) {
  trace('param tokenId');
  ConfirmationToken.findById(tokenId)
    .populate('user')
    .run(function(err, token) {
      log(err);
      req.token = !err && token;
      next();
    });
});
/** Pre condition param noteId into req.note. */
app.param('noteId', function(req, res, next, noteId) {
  trace('param noteId');
  Announcement.findById(noteId, function(err, note) {
    log(err);
    req.note = !err && note;
    next();
  });
});
/** Pre condition param lessonId into req.grade. */
app.param('gradeId', function(req, res, next, gradeId) {
  trace('param gradeId');
  req.grade = req.user.grades && req.user.grades.id(gradeId)
  next();
});
/** Pre condition param lessonId into req.currentLesson. */
app.param('lessonId', function(req, res, next, lessonId) {
  trace('param lessonId');
  Lesson.findOne({
    number: lessonId
  }).populate('unit')
    .populate('homework')
    .populate('extra')
    .populate('videos')
    .populate('readings')
    .run(function(err, lesson) {
      log(err);
      req.currentLesson = !err && lesson;
      res.local('currentLesson', req.currentLesson);
      if (req.currentLesson) {
        Unit.findById(
          req.currentLesson.unit.id
        ).populate('projects')
          .run(function(err, unit) {
            log(err);
            req.currentUnit = !err && unit;
            res.local('currentUnit', req.currentUnit);
            next();
          });
      } else {
        req.flash('error', 'Whoops! Lesson does not exist.');
        res.redirect('/default');
      }
    });
});
/** Pre condition param videoId into req.video. */
app.param('videoId', function(req, res, next, videoId) {
  trace('param videoId');
  req.video = req.currentLesson.videos && req.currentLesson.videos[videoId];
  next();
});
/** Pre condition param projectId into req.project. */
app.param('projectId', function(req, res, next, projectId) {
  trace('param projectId');
  req.project = req.currentUnit.projects && req.currentUnit.projects[projectId];
  next();
});
/** Pre condition param readingId into req.reading. */
app.param('readingId', function(req, res, next, readingId) {
  trace('param readingId');
  req.reading = req.currentLesson.readings && req.currentLesson.readings[readingId];
  next();
});
/** Pre condition param extraId into req.extra. */
app.param('extraId', function(req, res, next, extraId) {
  trace('param extraId');
  req.extra = req.currentLesson.extra && req.currentLesson.extra[extraId];
  next();
});
/** Pre condition param unit into req.unit. */
app.param('unit', function(req, res, next, unitId) {
  trace('param unit');
  Unit.findById(unitId, function(err, unit) {
    log(err);
    req.unit = !err && unit;
    next();
  });
});
/** Pre condition param lesson into req.lesson. */
app.param('lesson', function(req, res, next, lesson) {
  trace('param lesson');
  Lesson.findById(lesson, function(err, lesson) {
    log(err);
    req.lesson = !err && lesson;
    next();
  });
});
/** Pre condition param lesson into req.lesson. */
app.param('lesson', function(req, res, next, lessonId) {
  trace('param lesson');
  Lesson.findById(lessonId, function(err, lesson) {
    log(err);
    req.lesson = !err && lesson;
    next();
  });
});
/** Pre condition param homework into req.homework. */
app.param('homework', function(req, res, next, homeworkId) {
  trace('param homework');
  Homework.findById(homeworkId, function(err, homework) {
    log(err);
    req.homework = !err && homework;
    next();
  });
});
/** Pre condition param project into req.project. */
app.param('project', function(req, res, next, projectId) {
  trace('param project');
  Project.findById(projectId, function(err, project) {
    log(err);
    req.project = !err && project;
    next();
  });
});
/** Pre condition param extra into req.extra. */
app.param('extra', function(req, res, next, extraId) {
  trace('param extra');
  Extra.findById(extraId, function(err, extra) {
    log(err);
    req.extra = !err && extra;
    next();
  });
});
/** Pre condition param video into req.video. */
app.param('video', function(req, res, next, videoId) {
  trace('param video');
  Video.findById(videoId, function(err, video) {
    log(err);
    req.video = !err && video;
    next();
  });
});
/** Pre condition param reading into req.reading. */
app.param('reading', function(req, res, next, readingId) {
  trace('param reading');
  Reading.findById(readingId, function(err, reading) {
    log(err);
    req.reading = !err && reading;
    next();
  });
});
/** Defaults for each type of user. */
app.get('/default', function(req, res) {
  trace('GET /default');
  if (req.currentUser.canAccessAdminPanel()) {
    res.redirect('/admin');
  } else if (req.currentUser.canAccessDashboard()) {
    res.redirect('/dashboard');
  } else if (req.currentUser.canReadLesson()) {
    res.redirect('/lessons');
  } else {
    // ERROR 101: permission not set.
    req.flash('error', 'ERROR 101: Your account appears to be corrupted. Please see admin.');
    res.redirect('/home');
  }
});
/** Default view iff logged in. */
app.get('/', function(req, res) {
  trace('GET /');
  if (req.currentUser.canAccessDashboard()) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/home');
  }
});
/** Default view iff not logged in. */
app.get('/home', function(req, res) {
  trace('GET /home');
  res.render('index', {
    page: 'home'
  });
});
/** A standard login post request. */
app.post('/login', function(req, res) {
  trace('POST /login');
  req.sanitize('user', 'username', 'entityEncode');
  req.sanitize('user', 'password', 'entityEncode');
  User.findOne({
    username: req.body.user.username
  }, function(err, user) {
    log(err);
    if (user && user.authenticate(req.body.user.password)) {
      req.session.user_id = user._id;
      if (req.body.user.rememberme) {
        LoginToken.remove({ username: user.username }, function() {
          var token = new LoginToken({ username: user.username });
          token.save(function(err){
            log(err);
            res.cookie('rememberme', token.cookieValue, { maxAge: COOKIE_LIFETIME });
            req.flash('info', 'Logged in successfully as %s', user.username);
            res.redirect('/default');
          });
        });
      } else {
        req.flash('info', 'Logged in successfully as %s', user.username);
        res.redirect('/default');
      }
    } else {
      req.flash('error', 'Invalid username or password.');
      res.redirect('/home');
    }
  });
});
/** Logging out. */
app.get('/logout', function(req, res) {
  trace('GET /logout');
  if (req.session) {
    LoginToken.remove({ username: req.currentUser.username }, function() {});
    res.clearCookie('rememberme');
    delete req.session.user_id;
    req.flash('info', 'Logged out successfully!');
  }
  res.redirect('/home');
});
/** Admin Control Panel. */
app.get('/admin', checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('GET /admin');
  res.render('admin', {
    page: 'admin/index'
  });
});
/** Announcements panel */
app.get('/admin/announcements', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/announcements');
  Announcement.find({}).sort('date', -1).run(function(err, news) {
    log(err);
    res.render('admin/announcements', {
      page: 'admin/announcements',
      news: news
    });
  });
});
/** Post new announcement */
app.post('/admin/announcements/new', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/announcement/new');
  req.sanitize('announcement', 'title', 'entityEncode');
  req.sanitize('announcement', 'content', 'xss');
  var announcement = new Announcement({
    title: req.body.announcement.title,
    content: req.body.announcement.content,
    date: new Date()
  });
  announcement.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Announcement was not added successfully.');
    } else {
      req.flash('info', 'Announcement was added successfully.');
    }
    res.redirect('/admin/announcements');
  });
});
/** Edit an announcement. */
app.get('/admin/announcements/edit/:noteId', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/announcements/edit/:noteId');
  if (req.note) {
    res.render('admin/announcements/edit', {
      page: 'admin/announcements/edit',
      note: req.note
    });
  } else {
    req.flash('error', 'Malformed noteID.');
    res.redirect('/admin/announcements');
  }
});
/** Save edit a note. */
app.post('/admin/announcements/edit/:noteId', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/announcements/edit/:noteId');
  req.sanitize('note', 'title', 'entityEncode');
  req.sanitize('note', 'content', 'xss');
  if (req.note) {
    req.note.title = req.body.note.title;
    if (req.body.note.content != '') {
      req.note.content = req.body.note.content;
    }
    req.note.date = new Date();
    req.note.save(function(err){
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'Note was not saved successfully.');
      } else {
        req.flash('info', 'Note was saved successfully.');
      }
      res.redirect('/admin/announcements');
    });
  } else {
    req.flash('error', 'Malformed noteID.');
    res.redirect('/admin/announcements');
  }
});
/** Delete an announcement. */
app.get('/admin/announcements/delete/:noteId', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/announcements/delete/:noteId');
  if (req.note) {
    req.note.remove(function(err){
      log(err);
      req.flash('info', 'Post deleted.');
      res.redirect('/admin/announcements');
    });
  } else {
    req.flash('error', 'Malformed noteID.');
    res.redirect('/admin/announcements');
  }
});
/** Unit panel */
app.get('/admin/units', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/units');
  Unit.find({}).sort('number', 1).run(function(err, units) {
    log(err);
    Lesson.find({}).sort('number', 1).run(function(err, lessons) {
      log(err);
      Project.find({}).sort('projectLessonNumber', 1).run(function(err, projects) {
        log(err);
        res.render('admin/units', {
          page: 'admin/units',
          units: units,
          lessons: lessons,
          projects: projects
        });
      });
    });
  });
});
/** Post new unit */
app.post('/admin/units/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/units/add');
  req.sanitize('unit', 'name', 'entityEncode');
  var unit = new Unit({
    number: req.body.unit.number,
    name: req.body.unit.name,
    projectLessonNumber: req.body.unit.projectLessonNumber
  });
  if (req.body.unit.projects && req.body.unit.projects.indexOf("undefined") != -1) {
    unit.projects = [];
  } else {
    unit.projects = req.body.unit.projects;
  }

  unit.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Unit was not added successfully.');
    } else {
      req.flash('info', 'Unit was added successfully.');
    }
    res.redirect('/admin/units');
  });
});
/** Edit an unit. */
app.get('/admin/units/edit/:unit', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/units/edit/:unit');
  if (req.unit) {
    Lesson.find({}).sort('number', 1).run(function(err, lessons) {
      log(err);
      Project.find({}).sort('projectLessonNumber', 1).run(function(err, projects) {
        log(err);
        res.render('admin/units/edit', {
          page: 'admin/units/edit',
          unit: req.unit,
          lessons: lessons,
          projects: projects
        });
      });
    });
  } else {
    req.flash('error', 'Malformed unitId.');
    res.redirect('/admin/unit');
  }
});
/** Save edit a unit. */
app.post('/admin/units/edit/:unit', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/units/edit/:unit');
  req.sanitize('unit', 'name', 'entityEncode');
  if (req.unit) {
    req.unit.number = req.body.unit.number;
    req.unit.name = req.body.unit.name;
    req.unit.lessons = req.body.unit.lessons;
    if (req.body.unit.projects.indexOf("undefined") != -1) {
      req.unit.projects = [];
    } else {
      req.unit.projects = req.body.unit.projects;
    }
    req.unit.projectLessonNumber = req.body.unit.projectLessonNumber;

    req.unit.save(function(err){
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'Unit was not saved successfully.');
      } else {
        req.flash('info', 'Unit was saved successfully.');
      }
      res.redirect('/admin/units');
    });
  } else {
    req.flash('error', 'Malformed unitId.');
    res.redirect('/admin/units');
  }
});
/** Delete a unit. */
app.get('/admin/units/delete/:unit', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/units/delete/:unit');
  if (req.unit) {
    req.unit.remove(function(err) {
      log(err);
      req.flash('info', 'unit deleted.');
      res.redirect('/admin/units');
    });
  } else {
    req.flash('error', 'Malformed unitId.');
    res.redirect('/admin/units');
  }
});
/** Lessons panel */
app.get('/admin/lessons', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/lessons');
  // TODO: Sort
  Unit.find({}).sort('number', 1).run(function(err, units) {
    log(err);
    Lesson.find({}).sort('number', 1).run(function(err, lessons) {
      log(err);
      Homework.find({}).sort('name', 1).run(function(err, homeworks) {
        log(err);
        Project.find({}).sort('projectLessonNumber', 1).run(function(err, projects) {
          log(err);
          Extra.find({}).sort('name', 1).run(function(err, extras) {
            log(err);
            Video.find({}).sort('name', 1).run(function(err, videos) {
              log(err);
              Reading.find({}).sort('name', 1).run(function(err, readings) {
                log(err);
                res.render('admin/lessons', {
                  page: 'admin/lessons/index',
                  units: units,
                  lessons: lessons,
                  homeworks: homeworks,
                  projects: projects,
                  extras: extras,
                  videos: videos,
                  readings: readings
                });
              });
            });
          });
        });
      });
    });
  });
});
/** Post new lesson */
app.post('/admin/lessons/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/lessons/add');
  req.sanitize('lesson', 'name', 'entityEncode');
  var lesson = new Lesson({
    number: req.body.lesson.number,
    name: req.body.lesson.name,
    unit: req.body.lesson.unit,
    homework: req.body.lesson.homework,
    project: req.body.lesson.project,
    extra: req.body.lesson.extra,
    videos: req.body.lesson.videos,
    readings: req.body.lesson.readings
  });
  lesson.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Lesson was not added successfully.');
    } else {
      req.flash('info', 'Lesson was added successfully.');
    }
    res.redirect('/admin/lessons');
  });
});
/** Edit a lesson. */
app.get('/admin/lessons/edit/:lesson', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/lessons/edit/:lesson');
  if (req.lesson) {
    Unit.find({}).sort('number', 1).run(function(err, units) {
      log(err);
      Homework.find({}).sort('name', 1).run(function(err, homeworks) {
        log(err);
        Project.find({}).sort('projectLessonNumber', 1).run(function(err, projects) {
          log(err);
          Extra.find({}).sort('name', 1).run(function(err, extras) {
            log(err);
            Video.find({}).sort('name', 1).run(function(err, videos) {
              log(err);
              Reading.find({}).sort('name', 1).run(function(err, readings) {
                log(err);
                res.render('admin/lessons/edit', {
                  page: 'admin/lessons/edit',
                  units: units,
                  lesson: req.lesson,
                  homeworks: homeworks,
                  projects: projects,
                  extras: extras,
                  videos: videos,
                  readings: readings
                });
              });
            });
          });
        });
      });
    });
  } else {
    req.flash('error', 'Malformed lessonID.');
    res.redirect('/admin/lessons');
  }
});
/** Save edit a lesson. */
app.post('/admin/lessons/edit/:lesson', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/lessons/edit/:lesson');
  req.sanitize('lesson', 'name', 'entityEncode');
  if (req.lesson) {
    req.lesson.number = req.body.lesson.number;
    req.lesson.name = req.body.lesson.name;
    req.lesson.unit = req.body.lesson.unit;
    req.lesson.homework = req.body.lesson.homework;
    req.lesson.project = req.body.lesson.project;
    req.lesson.extra = req.body.lesson.extra;
    req.lesson.videos = req.body.lesson.videos;
    req.lesson.readings = req.body.lesson.readings;

    req.lesson.save(function(err){
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'Lesson was not saved successfully.');
      } else {
        req.flash('info', 'Lesson was saved successfully.');
      }
      res.redirect('/admin/lessons');
    });
  } else {
    req.flash('error', 'Malformed lessonId.');
    res.redirect('/admin/lessons');
  }
});
/** Delete a lesson. */
app.get('/admin/lessons/delete/:lesson', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/lessons/delete/:lesson');
  if (req.lesson) {
    req.lesson.remove(function(err) {
      log(err);
      req.flash('info', 'Lesson deleted.');
      res.redirect('/admin/lessons');
    });
  } else {
    req.flash('error', 'Malformed lessonId.');
    res.redirect('/admin/lessons');
  }
});
/** Homework panel */
app.get('/admin/homework', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/homework');
  Homework.find({}).sort('name', 1).run(function(err, homeworks) {
    log(err);
    res.render('admin/homework', {
      page: 'admin/homework',
      homeworks: homeworks
    });
  });
});
/** Post new homework */
app.post('/admin/homework/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/homework/add');
  req.sanitize('homework', 'name', 'entityEncode');
  var homework = new Homework({
    name: req.body.homework.name
  });
  homework.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Homework was not added successfully.');
    } else {
      req.flash('info', 'Homework was added successfully.');
    }
    res.redirect('/admin/homework');
  });
});
/** Edit an homework. */
app.get('/admin/homework/edit/:homework', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/homework/edit/:homework');
  if (req.homework) {
    res.render('admin/homework/edit', {
      page: 'admin/homework/edit',
      homework: req.homework
    });
  } else {
    req.flash('error', 'Malformed homeworkId.');
    res.redirect('/admin/homework');
  }
});
/** Save edit a homework. */
app.post('/admin/homework/edit/:homework', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/homework/edit/:homework');
  req.sanitize('homework', 'name', 'entityEncode');
  if (req.homework) {
    req.homework.name = req.body.homework.name;

    req.homework.save(function(err){
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'Homework was not saved successfully.');
      } else {
        req.flash('info', 'Homework was saved successfully.');
      }
      res.redirect('/admin/homework');
    });
  } else {
    req.flash('error', 'Malformed homeworkId.');
    res.redirect('/admin/homework');
  }
});
/** Delete an homework. */
app.get('/admin/homework/delete/:homework', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/homework/delete/:homework');
  if (req.homework) {
    req.homework.remove(function(err) {
      log(err);
      req.flash('info', 'Homework deleted.');
      res.redirect('/admin/homework');
    });
  } else {
    req.flash('error', 'Malformed homeworkId.');
    res.redirect('/admin/homework');
  }
});
/** Project panel */
app.get('/admin/projects', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/projects');
  Project.find({}).sort('projectLessonNumber', 1).run(function(err, projects) {
    log(err);
    res.render('admin/projects', {
      page: 'admin/projects',
      projects: projects
    });
  });
});
/** Post new project */
app.post('/admin/projects/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/projects/add');
  req.sanitize('project', 'name', 'entityEncode');
  var project = new Project({
    name: req.body.project.name,
    projectLessonNumber: req.body.project.projectLessonNumber
  });
  project.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Project was not added successfully.');
    } else {
      req.flash('info', 'Project was added successfully.');
    }
    res.redirect('/admin/projects');
  });
});
/** Edit an project. */
app.get('/admin/projects/edit/:project', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/projects/edit/:project');
  if (req.project) {
    res.render('admin/projects/edit', {
      page: 'admin/projects/edit',
      project: req.project
    });
  } else {
    req.flash('error', 'Malformed projectId.');
    res.redirect('/admin/projects');
  }
});
/** Save edit a project. */
app.post('/admin/projects/edit/:project', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/projects/edit/:project');
  req.sanitize('project', 'name', 'entityEncode');
  if (req.project) {
    req.project.name = req.body.project.name;
    req.project.projectLessonNumber = req.body.project.projectLessonNumber;

    req.project.save(function(err){
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'project was not saved successfully.');
      } else {
        req.flash('info', 'project was saved successfully.');
      }
      res.redirect('/admin/projects');
    });
  } else {
    req.flash('error', 'Malformed projectId.');
    res.redirect('/admin/projects');
  }
});
/** Delete an project. */
app.get('/admin/projects/delete/:project', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/projects/delete/:project');
  if (req.project) {
    req.project.remove(function(err) {
      log(err);
      req.flash('info', 'Project deleted.');
      res.redirect('/admin/projects');
    });
  } else {
    req.flash('error', 'Malformed projectId.');
    res.redirect('/admin/projects');
  }
});
/** Extra panel */
app.get('/admin/extra', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/extra');
  Extra.find({}).sort('name', 1).run(function(err, extras) {
    log(err);
    res.render('admin/extra', {
      page: 'admin/extra',
      extras: extras
    });
  });
});
/** Post new extra */
app.post('/admin/extra/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/extra/add');
  req.sanitize('extra', 'name', 'entityEncode');
  var extra = new Extra({
    name: req.body.extra.name
  });
  extra.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Extra was not added successfully.');
    } else {
      req.flash('info', 'Extra was added successfully.');
    }
    res.redirect('/admin/extra');
  });
});
/** Edit an extra. */
app.get('/admin/extra/edit/:extra', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/extra/edit/:extra');
  if (req.extra) {
    res.render('admin/extra/edit', {
      page: 'admin/extra/edit',
      extra: req.extra
    });
  } else {
    req.flash('error', 'Malformed extraId.');
    res.redirect('/admin/extra');
  }
});
/** Save edit a extra. */
app.post('/admin/extra/edit/:extra', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/extra/edit/:extra');
  req.sanitize('extra', 'name', 'entityEncode');
  if (req.extra) {
    req.extra.name = req.body.extra.name;

    req.extra.save(function(err){
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'extra was not added successfully.');
      } else {
        req.flash('info', 'extra was added successfully.');
      }
      res.redirect('/admin/extra');
    });
  } else {
    req.flash('error', 'Malformed extraId.');
    res.redirect('/admin/extra');
  }
});
/** Delete an extra. */
app.get('/admin/extra/delete/:extra', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/extra/delete/:extra');
  if (req.extra) {
    req.extra.remove(function(err) {
      log(err);
      req.flash('info', 'Extra deleted.');
      res.redirect('/admin/extra');
    });
  } else {
    req.flash('error', 'Malformed extraId.');
    res.redirect('/admin/extra');
  }
});
/** video panel */
app.get('/admin/videos', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/videos');
  Video.find({}).sort('name', 1).run(function(err, videos) {
    log(err);
    res.render('admin/videos', {
      page: 'admin/videos',
      videos: videos
    });
  });
});
/** Post new video */
app.post('/admin/videos/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/videos/add');
  req.sanitize('video', 'name', 'entityEncode');
  req.sanitize('video', 'url', 'entityEncode');
  var video = new Video({
    name: req.body.video.name,
    url: req.body.video.url
  });
  video.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Video was not added successfully.');
    } else {
      req.flash('info', 'Video was added successfully.');
    }
    res.redirect('/admin/videos');
  });
});
/** Edit an video. */
app.get('/admin/videos/edit/:video', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/videos/edit/:video');
  if (req.video) {
    res.render('admin/videos/edit', {
      page: 'admin/videos/edit',
      video: req.video
    });
  } else {
    req.flash('error', 'Malformed videoId.');
    res.redirect('/admin/videos');
  }
});
/** Save edit a video. */
app.post('/admin/videos/edit/:video', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/videos/edit/:video');
  req.sanitize('video', 'name', 'entityEncode');
  req.sanitize('video', 'url', 'entityEncode');
  if (req.video) {
    req.video.name = req.body.video.name;
    req.video.url = req.body.video.url;

    req.video.save(function(err){
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'video was not added successfully.');
      } else {
        req.flash('info', 'video was added successfully.');
      }
      res.redirect('/admin/videos');
    });
  } else {
    req.flash('error', 'Malformed videoId.');
    res.redirect('/admin/videos');
  }
});
/** Delete an video. */
app.get('/admin/videos/delete/:video', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/videos/delete/:video');
  if (req.video) {
    req.video.remove(function(err) {
      log(err);
      req.flash('info', 'video deleted.');
      res.redirect('/admin/videos');
    });
  } else {
    req.flash('error', 'Malformed videoId.');
    res.redirect('/admin/videos');
  }
});
/** Reading panel */
app.get('/admin/readings', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/readings');
  Reading.find({}).sort('name', 1).run(function(err, readings) {
    log(err);
    res.render('admin/readings', {
      page: 'admin/readings',
      readings: readings
    });
  });
});
/** Post new reading */
app.post('/admin/readings/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/readings/add');
  req.sanitize('reading', 'name', 'entityEncode');
  req.sanitize('reading', 'location', 'entityEncode');
  var reading = new Reading({
    name: req.body.reading.name,
    location: req.body.reading.location,
    SICP: req.body.reading.SICP
  });
  reading.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Reading was not added successfully.');
    } else {
      req.flash('info', 'Reading was added successfully.');
    }
    res.redirect('/admin/readings');
  });
});
/** Edit an reading. */
app.get('/admin/readings/edit/:reading', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/readings/edit/:reading');
  if (req.reading) {
    res.render('admin/readings/edit', {
      page: 'admin/readings/edit',
      reading: req.reading
    });
  } else {
    req.flash('error', 'Malformed readingId.');
    res.redirect('/admin/readings');
  }
});
/** Save edit a reading. */
app.post('/admin/readings/edit/:reading', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/readings/edit/:reading');
  req.sanitize('reading', 'name', 'entityEncode');
  req.sanitize('reading', 'location', 'entityEncode');
  if (req.reading) {
    req.reading.name = req.body.reading.name;
    req.reading.location = req.body.reading.location;
    req.reading.SICP = req.body.reading.SICP;

    req.reading.save(function(err){
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'reading was not added successfully.');
      } else {
        req.flash('info', 'reading was added successfully.');
      }
      res.redirect('/admin/readings');
    });
  } else {
    req.flash('error', 'Malformed readingId.');
    res.redirect('/admin/readings');
  }
});
/** Delete an reading. */
app.get('/admin/readings/delete/:reading', checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/readings/delete/:reading');
  if (req.reading) {
    req.reading.remove(function(err) {
      log(err);
      req.flash('info', 'reading deleted.');
      res.redirect('/admin/readings');
    });
  } else {
    req.flash('error', 'Malformed readingId.');
    res.redirect('/admin/readings');
  }
});
/** Manage users. */
app.get('/admin/users', checkPermit('canAccessAdminPanel'), checkPermit('canReadUserInfoEveryone'), function(req, res) {
  trace('GET /admin/users');
  User.find({ permission: User.Permissions.Grader }).sort('username', 1).run(function(err, graders) {
    log(err);
    User.find({}).sort('username', 1).run(function(err, users) {
      log(err);
      res.render('admin/users', {
        page: 'admin/users/index',
        users: users,
        graders: graders
      });
    });
  });
});
/** Add an user. */
app.post('/admin/users/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteUserInfoEveryone'), function(req, res) {
  trace('POST /admin/users/add');
  req.sanitize('user', 'username', 'entityEncode');
  req.sanitize('user', 'password', 'entityEncode');
  req.sanitize('user', 'fullname', 'entityEncode');
  req.sanitize('user', 'email', 'entityEncode');
  var user = new User({
    username: req.body.user.username,
    fullname: req.body.user.fullname,
    isEnable: req.body.user.isEnable || false,
    isActivated: req.body.user.isActivated || false
  });
  if (req.body.user.email != "") {
    user.email = req.body.user.email;
  }
  user.password = req.body.user.password;
  user.permission = getType(req.body.user.type);

  User.findOne({
      username: req.body.user.grader
    }, function(err, grader) {
    log(err);
    if (!err && grader) {
      user.grader = grader;
      user.save(function(err){
        if (err) {
          log(err);
          flashErr(req, err);
          if (err.err) {
            req.flash('error', err.err);
          }
          req.flash('error', 'User %s was not saved successfully.', user.username);
        } else {
          req.flash('info', 'User %s was saved successfully.', user.username);
        }
        res.redirect('/admin/users');
      });
    } else {
      log(err);
      req.flash('error', 'Grader %s does not exist.', req.body.user.grader);
      req.flash('error', 'User %s was not saved successfully.', user.username);
      res.redirect('/admin/users');
    }
  });
});
/** Edit an user. */
app.get('/admin/users/edit/:userId', checkPermit('canAccessAdminPanel'), checkPermit('canReadUserInfoEveryone'), function(req, res) {
  trace('GET /admin/users/edit/:userId');
  if (req.user) {
    User.find({ permission: User.Permissions.Grader }).sort('username', 1).run(function(err, graders) {
      log(err);
        res.render('admin/users/edit', {
        page: 'admin/users/edit',
        user: req.user,
        graders: graders
      });
    });
  } else {
    req.flash('error', 'Malformed userID.');
    res.redirect('/admin/users');
  }
});
/** Save edit an user. */
app.post('/admin/users/edit/:userId', checkPermit('canAccessAdminPanel'), checkPermit('canWriteUserInfoEveryone'), function(req, res) {
  trace('POST /admin/users/edit/:userId');
  req.sanitize('user', 'username', 'entityEncode');
  req.sanitize('user', 'password', 'entityEncode');
  req.sanitize('user', 'fullname', 'entityEncode');
  req.sanitize('user', 'email', 'entityEncode');
  if (req.user) {
    if (req.body.user.password != '') {
      req.user.password = req.body.user.password;
    }
    req.user.username = req.body.user.username;
    req.user.fullname = req.body.user.fullname;
    req.user.isEnable = req.body.user.isEnable || false;
    req.user.isActivated = req.body.user.isActivated || false;
    req.user.email = req.body.user.email;
    req.user.currentLesson = req.body.user.currentLesson;
    req.user.currentUnit = req.body.user.currentUnit;
    req.user.units = req.body.user.units;
    req.user.permission = req.body.user.permission;

    User.findOne({
        username: req.body.user.grader
      }, function(err, grader) {
      log(err);
      if (!err && grader) {
        req.user.grader = grader;
        req.user.save(function(err){
          if (err) {
            log(err);
            flashErr(req, err);
            if (err.err) {
              req.flash('error', err.err);
            }
            req.flash('error', 'User %s was not saved successfully.', req.user.username);
          } else {
            req.flash('info', 'User %s was saved successfully.', req.user.username);
          }
          res.redirect('/admin/users');
        });
      } else {
        log(err);
        req.flash('error', 'Grader %s does not exist.', req.body.user.grader);
        req.flash('error', 'User %s was not saved successfully.', req.user.username);
        res.redirect('/admin/users');
      }
    });
  } else {
    req.flash('error', 'Malformed userID.');
    res.redirect('/admin/users');
  }
});
/** Delete a user. */
app.get('/admin/users/delete/:userId', checkPermit('canAccessAdminPanel'), checkPermit('canWriteUserInfoEveryone'), function(req, res) {
  trace('DEL /admin/users/delete/:userId');
  if (req.user) {
    req.user.remove(function(err) {
      log(err);
      req.flash('info', 'user deleted.');
      res.redirect('/admin/users');
    });
  } else {
    req.flash('error', 'Malformed userId.');
    res.redirect('/admin/users');
  }
});
/** Manage grades. */
app.get('/admin/grades', checkPermit('canAccessAdminPanel'), checkPermit('canReadGradeEveryone'), function(req, res) {
  trace('GET /admin/grades');
  User.find({ permission: User.Permissions.Student }).sort('username', 1).run(function(err, users) {
    log(err);
    res.render('admin/grades/index', {
      page: 'admin/grades/index',
      users: users
    });
  });
});
/** Get grades from a user. */
app.get('/admin/grades/:username', checkPermit('canAccessAdminPanel'), checkPermit('canReadGradeEveryone'), function(req, res) {
  trace('GET /admin/grades/:username');
  if(req.user) {
    res.render('admin/grades/user', {
      page: 'admin/grades/user',
      user: req.user
    });
  } else {
    req.flash('error', 'Whoops! User does not exist.');
    res.redirect('/default');
  }
});
/** Add a grade. */
app.post('/admin/grades/:username/add', checkPermit('canAccessAdminPanel'), checkPermit('canWriteGradeEveryone'), function(req, res) {
  trace('POST /admin/:username/add');
  req.sanitize('grade', 'name', 'entityEncode');
  req.sanitize('grade', 'grade', 'entityEncode');
  req.user.grades.push({
    name: req.body.grade.name,
    order: req.body.grade.order,
    grade: req.body.grade.grade,
    weight: req.body.grade.weight
  });
  req.user.save(function(err) {
    if (err) {
      log(err);
      flashErr(req, err);
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Grade is not entered.');
    } else {
      req.flash('info', 'Grade is entered!');
    }
    res.redirect('/admin/grades/' + req.user.username);
  });
});
/** Edit a grade from a user. */
app.get('/admin/grades/:username/:gradeId', checkPermit('canAccessAdminPanel'), checkPermit('canReadGradeEveryone'), function(req, res) {
  trace('GET /admin/grades/:username/:gradeId');
  if(req.user && req.grade) {
    res.render('admin/grades/edit', {
      page: 'admin/grades/edit',
      user: req.user,
      grade: req.grade
    });
  } else {
    req.flash('error', 'Whoops! Grade does not exist.');
    res.redirect('/default');
  }
});
/** Edit a grade. */
app.post('/admin/grades/:username/:gradeId', checkPermit('canAccessAdminPanel'), checkPermit('canWriteGradeEveryone'), function(req, res) {
  trace('POST /admin/:username/:gradeId');
  req.sanitize('grade', 'name', 'entityEncode');
  req.sanitize('grade', 'grade', 'entityEncode');
  if (req.user && req.grade) {
    req.grade.name = req.body.grade.name;
    req.grade.order = req.body.grade.order;
    req.grade.grade = req.body.grade.grade;
    req.grade.weight = req.body.grade.weight;
    req.user.save(function(err) {
      if (err) {
        log(err);
        flashErr(req, err);
        if (err.err) {
          req.flash('error', err.err);
        }
        req.flash('error', 'Grade is not saved.');
      } else {
        req.flash('info', 'Grade is saved!');
      }
      res.redirect('/admin/grades/' + req.user.username);
    });
  } else {
    req.flash('error', 'Whoops! Grade does not exist.');
    res.redirect('/default');
  }
});
/** Feedback for admins. */
app.get('/admin/feedback', checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('GET /admin/feedback');
  Ticket.find({ responder : req.currentUser.email }).sort('date', -1).run(function(err, tickets) {
    log(err);
    res.render('admin/feedback', {
      page: 'admin/feedback',
      tickets: tickets
    });
  });
});
/** All feedback for admins. */
app.get('/admin/feedback/all', checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('GET /admin/feedback/all');
  Ticket.find({}).sort('date', -1).run(function(err, tickets) {
    log(err);
    res.render('admin/feedback/all', {
      page: 'admin/feedback/all',
      tickets: tickets
    });
  });
});
// TODO: error checking
app.post('/admin/feedback/reply/:ticketId', checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('POST /admin/feedback/reply/:ticketId');
  req.sanitize('ticket', 'response', 'entityEncode');
  sendResponseEmail(req, function(err){
    if (!err) {
      req.ticket.date = new Date();
      req.ticket.responses.push(req.body.ticket.response);
      req.ticket.status = false;
      req.ticket.save(function(err) {
        log(err);
        res.redirect('/admin/feedback');
      });
    }
  });
});
/** Student dashboard. */
app.get('/dashboard', checkPermit('canAccessDashboard'), loadLesson, loadProgress, function(req, res) {
  trace('GET /dashboard');
  if (req.currentLesson && req.currentLesson.unit) {
    Announcement.find({}).sort('date', -1).limit(3).run(function(err, news) {
      log(err);
      res.render('dashboard', {
        page: 'dashboard',
        news: news
      });
    });
  } else {
    req.flash('error', 'The lesson you are trying to access does not exist.');
    res.redirect('/dashboard');
  }
});
/** Change dashboard. */
app.get('/dashboard/:lessonId', checkPermit('canAccessDashboard'), loadProgress, function(req, res) {
  trace('GET /dashboard/:lessonId');
  if (req.currentLesson && req.currentLesson.unit) {
    req.currentUser.currentLesson = req.currentLesson.number;
    req.currentUser.save(function(err) {
      log(err);
      Announcement.find({}).sort('name', 1).limit(3).run(function(err, news) {
        log(err);
        res.render('dashboard', {
          page: 'dashboard',
          news: news
        });
      });
    });
  } else {
    req.flash('error', 'The lesson you are trying to access does not exist.');
    res.redirect('/dashboard');
  }
});
/** Get grades for current user. */
app.get('/grades', checkPermit('canReadGrade'), function(req, res) {
  trace('GET /grades');
  res.render('grades', {
    page: 'grades',
  });
});
/** Settings page. */
app.get('/settings', checkPermit('canReadUserInfo'), function(req, res) {
  trace('GET /settings');
  res.render('settings', {
    page: 'settings',
  });
});
/** Save edit an user. */
app.post('/settings', checkPermit('canWritePassword'), function(req, res) {
  trace('POST /settings');
  req.sanitize('user', 'username', 'entityEncode');
  req.sanitize('user', 'fullname', 'entityEncode');
  req.sanitize('user', 'password', 'entityEncode');
  req.sanitize('user', 'newpassword', 'entityEncode');
  req.sanitize('user', 'confirm', 'entityEncode');
  req.sanitize('user', 'email', 'entityEncode');
  if (req.currentUser.authenticate(req.body.user.password)) {
    req.currentUser.fullname = req.body.user.fullname;
    req.currentUser.units = req.body.user.units;

    if (req.body.user.newpassword != '') {
      if (req.body.user.newpassword === req.body.user.confirm) {
        req.currentUser.password = req.body.user.newpassword;
      } else {
        req.flash('error', 'User %s was not saved successfully because new passwords did not match.', req.currentUser.username);
        res.redirect('/settings');
        return;
      }
    }

    if (req.currentUser.email != req.body.user.email || !req.currentUser.isActivated) {
      req.currentUser.email = req.body.user.email;
      req.currentUser.isActivated = false;
      var token = new ConfirmationToken({
        user: req.currentUser
      });
      req.currentUser.save(function(err) {
        if (err) {
          log(err);
          flashErr(req, err);
          if (err.err) {
            req.flash('error', 'Email is registered. Please use your email.');
          }
          req.flash('error', 'User %s was not saved successfully.', req.currentUser.username);
          res.redirect('/default');
        } else {
          ConfirmationToken.remove({ user: req.currentUser }, function(err) {
            log(err);
            token.save(function(err) {
              log(err);
              sendEmailConfirmation(req, token, function(err) {
                log(err);
                if (err) {
                  req.flash('error', 'There is an error sending your confirmation email. Please contact administrator.');
                  res.redirect('/default');
                } else {
                  req.flash('info', 'An confirmation email has been sent to you. Please check your email.');
                  res.redirect('/default');
                }
              });
            });
          });
        }
      });
    } else {
      req.currentUser.email = req.body.user.email;
      req.currentUser.save(function(err) {
        if (err) {
          log(err);
          flashErr(req, err);
          if (err.err) {
            req.flash('error', 'Email is registered. Please use your email.');
          }
          req.flash('error', 'User %s was not saved successfully.', req.currentUser.username);
        } else {
          req.flash('info', 'User %s was saved successfully.', req.currentUser.username);
        }
        res.redirect('/default');
      });
    }
  } else {
    req.flash('error', 'Please enter your current password to make any changes.');
    res.redirect('/settings');
  }
});
/** Activate. */
app.get('/activate/:tokenId/:tokenNumber', function(req, res) {
  trace('GET /lessons');
  if (req.token && (req.token.token == req.params.tokenNumber)) {
    req.token.user.isActivated = true;
    req.token.user.save(function(err) {
      if (err) {
        log(err);
        req.flash('error', 'User %s was not activated successfully.', req.token.user.username);
        res.redirect('/home');
      } else {
        ConfirmationToken.remove({ user: req.token.user }, function(err) {
          log(err);
          req.flash('info', 'User %s was activated successfully. Please login to begin to use your account.', req.token.user.username);
          res.redirect('/home');
        });
      }
    });
  } else {
    req.flash('error', 'Invalid activation code');
    res.redirect('/home');
  }
});
/** Collective lessons. */
app.get('/lessons', checkPermit('canReadLesson'), function(req, res) {
  trace('GET /lessons');
  Lesson.find()
  .populate('homework')
  .populate('projects')
  .populate('extra')
  .populate('videos')
  .populate('readings')
  .sort('number', 1)
  .run(function(err, lessons) {
    log(err);
    Project.find({}, function(err, projects) {
      var projectLessons = [];
      for (var b in projects) {
        projectLessons.push(projects[b].projectLessonNumber.toString());
      }
      res.render('lessons', {
        page: 'lessons',
        lessons: lessons,
        projects: projects,
        projectLessons: projectLessons
      });
    });
  });
});
/** Viewing webcast by its URL. */
app.get('/webcast/:lessonId/:videoId', checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /webcast/:lessonId/:videoId');
  if(req.currentLesson && req.video) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        res.render('video', {
          page: 'webcast',
          videoId: req.params.videoId,
          videos: [req.video],
          showControls: req.currentUser.canWriteProgress()
        });
      });
    } else {
      res.render('video', {
        page: 'webcast',
        videoId: req.params.videoId,
        videos: [req.video],
        showControls: req.currentUser.canWriteProgress()
      });
    }
  } else {
    req.flash('error', 'Whoops! Webcast does not exist.');
    res.redirect('/default');
  }
});
/** Marking webcast as read. */
app.post('/webcast/:lessonId/:videoId', checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /webcast/:lessonId/:videoId');
  if(req.currentLesson && req.video) {
    req.video.isCompleted = true;
    res.redirect('/dashboard');
  } else {
    req.flash('error', 'Whoops! Webcast does not exist.');
    res.redirect('/dashboard');
  }
});
/** Viewing reading. */
app.get('/reading/:lessonId/:readingId', checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /reading/:lessonId/:readingId');
  // TODO: iframe view for SICP readings.
  if (req.currentLesson && req.reading) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        res.render('reading', {
          page: 'reading',
          reading: req.reading,
          readingId: req.params.readingId,
          showControls: req.currentUser.canWriteProgress()
        });
      });
    } else {
      res.render('reading', {
        page: 'reading',
        reading: req.reading,
        readingId: req.params.readingId,
        showControls: req.currentUser.canWriteProgress()
      });
    }
  } else {
    req.flash('error', 'Whoops! This reading does not exist.');
    res.redirect('/default');
  }
});

/** Viewing extra. */
app.get('/extra/:lessonId/:extraId', checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /extra/:lessonId/:extraId');
  if (req.currentLesson && req.extra) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        res.render('extra', {
          page: 'extra',
          extra: req.extra,
          extraId: req.params.extraId,
          showControls: req.currentUser.canWriteProgress()
        });
      });
    } else {
      res.render('extra', {
        page: 'extra',
        extra: req.extra,
        extraId: req.params.extraId,
        showControls: req.currentUser.canWriteProgress()
      });
    }
  } else {
    req.flash('error', 'Whoops! This extra does not exist.');
    res.redirect('/default');
  }
});
/** Marking reading as read. */
app.post('/reading/:lessonId/:readingId', checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /reading/:lessonId/:readingId');
  if(req.currentLesson && req.reading) {
    req.reading.isCompleted = true;
    res.redirect('/dashboard');
  } else {
    req.flash('error', 'Whoops! Reading does not exist.');
    res.redirect('/dashboard');
  }
});
/** Marking extra as read. */
app.post('/extra/:lessonId/:extraId', checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /extra/:lessonId/:extraId');
  if(req.currentLesson && req.extra) {
    req.extra.isCompleted = true;
    res.redirect('/dashboard');
  } else {
    req.flash('error', 'Whoops! Extra does not exist.');
    res.redirect('/dashboard');
  }
});
/** Homework.
 *  Defaults: display the one specified by currentUser.currentLesson.
 *  Only displays progress control when the user has permission. */
app.get('/homework', loadLesson, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /homework');
  if (req.currentLesson && req.currentLesson.homework) {
    res.render('homework', {
      page: 'homework',
      showControls: req.currentUser.canWriteProgress()
    });
  } else {
    req.flash('error', 'Whoops! Homework for this lesson does not exist.');
    res.redirect('/default');
  }
});
/** View homework at LESSONID.
 *  Only displays progress control when the user has permission. */
app.get('/homework/:lessonId', checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /homework/:lessonId');
  if (req.currentLesson && req.currentLesson.homework) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        res.render('homework', {
          page: 'homework',
          showControls: req.currentUser.canWriteProgress()
        });
      });
    } else {
      res.render('homework', {
        page: 'homework',
        showControls: req.currentUser.canWriteProgress()
      });
    }
  } else {
    req.flash('error', 'Whoops! Homework for this lesson does not exist.');
    res.redirect('/default');
  }
});
/** Marking homework as complete. */
app.post('/homework/:lessonId', checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /homework/:lessonId');
  if(req.currentLesson && req.currentLesson.homework) {
    if (req.body.confirm) {
      sendGraderNotification(req, function(err){
        if (!err) {
          req.currentLesson.homework.isCompleted = true;
          req.flash('info', "Your grader is notified of your submission. Any submission after this period is discarded.");
        } else {
          req.flash(err);
          req.flash('error', "Cannot send email to grader. Please see administration.");
        }
        res.redirect('/homework/' + req.params.lessonId);
      });
    } else {
      req.flash('error', 'You did not check the box to confirm your understanding of homework guidelines.');
      res.redirect('/homework/' + req.params.lessonId);
    }
  } else {
    req.flash('error', 'Whoops! Homework does not exist.');
    res.redirect('/dashboard');
  }
});

/** Marking project as complete. */
app.post('/project/:lessonId/:projectId', checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /project/:lessonId/:projectId');
  if(req.currentLesson && req.project) {
    if (req.body.confirm) {
      sendGraderProjectNotification(req, function(err){
        if (!err) {
          req.project.isCompleted = true;
        }
        res.redirect('/project/' + req.params.lessonId + '/' + req.params.projectId);
      });
    } else {
      req.flash('error', 'You did not check the box to confirm your understanding of homework guidelines.');
      res.redirect('/project/' + req.params.lessonId + '/' + req.params.projectId);
    }
  } else {
    req.flash('error', 'Whoops! Project does not exist.');
    res.redirect('/dashboard');
  }
});
/** View project solutions. */
app.get('/solutions/project/:lessonId/:projectId', checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('GET /solutions/project/:lessonId/:projectId');
  if(req.currentLesson && req.project) {
    if (req.project.isCompleted) {
      res.render('solution', {
        page: 'solution',
        type: 'project',
        name: req.project.name,
        projectId: req.params.projectId,
        showControls: req.currentUser.canWriteProgress()
      });
    } else {
      req.flash('error', "You haven't finished this assignment yet, so you can't look at these solutions!");
      res.redirect('/dashboard');
    }
  } else {
    req.flash('error', 'Whoops! Project does not exist.');
    res.redirect('/dashboard');
  }
});
/** View solution for TYPE at lessonId.
 *  Only displays progress control when the user has permission. */
// TODO: fix this, I removed :type in a quick fix. Add Lab Sol too.
app.get('/solutions/:type/:lessonId', checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /solutions/:type/:lessonId');
  var type = req.params.type;
  var checktype = req.params.type;
  if (['homework', 'extra', 'lab'].indexOf(type) === -1) {
    req.flash('error', "Whoops! The url you just went to does not exist.");
    res.redirect('/default');
    return;
  }
  if (type === 'lab') {
    checktype = 'homework';
  }
  if (req.currentLesson && req.currentLesson[checktype]) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        if (req.currentLesson[checktype].isCompleted) {
          res.render('solution', {
            page: 'solution',
            name: req.currentLesson[checktype].name,
            type: type,
            showControls: req.currentUser.canWriteProgress()
          });
        } else {
          req.flash('error', "You haven't finished this assignment yet, so you can't look at these solutions!");
          res.redirect('/dashboard');
        }
      });
    } else {
      res.render('solution', {
        page: 'solution',
        type: req.params.type,
        showControls: req.currentUser.canWriteProgress()
      });
    }
  } else {
    req.flash('error', 'Whoops! This solution does not exist.');
    res.redirect('/default');
  }
});
/** Project.
 *  Defaults: display the one specified by currentUser.currentLesson.
 *  Only displays progress control when the user has permission. */
app.get('/project/:lessonId/:projectId', checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /project/:lessonId/:projectId');
  if (req.currentUnit && req.project) {
    res.render('project', {
      page: 'project',
      project: req.project,
      projectId: req.params.projectId,
      showControls: req.currentUser.canWriteProgress()
    });
  } else {
    req.flash('error', 'Whoops! This project does not exist.');
    res.redirect('/default');
  }
});
/** Administration. */
app.get('/administration', checkPermit('canReadLesson'), function(req, res) {
  trace('GET /administration');
  res.render('administration', {
    page: 'administration'
  });
});
/** All announcements. */
app.get('/announcements', checkPermit('canReadLesson'), function(req, res) {
  trace('GET /announcements');
  Announcement.find({}).sort('date', -1).run(function(err, news) {
    log(err);
    res.render('announcements', {
      page: 'announcements',
      news: news
    });
  });
});
/** Feedback system. */
// TODO: Style feedback
// TODO: Make Google doc for general feedback.
app.get('/feedback', checkPermit('canAccessDashboard'), function(req, res) {
  trace('GET /feedback');
  Ticket.find({ complainer : req.currentUser.email }).sort('date', -1).run(function(err, tickets) {
    log(err);
    res.render('feedback', {
      page: 'feedback',
      tickets: tickets
    });
  });
});
// TODO: Error checking
app.post('/feedback/new', checkPermit('canAccessDashboard'), function(req, res) {
  trace('POST /feedback/new');
  req.sanitize('ticket', 'subject', 'entityEncode');
  req.sanitize('ticket', 'complaint', 'entityEncode');
  sendFeedbackEmail(req, function(err){
    if (!err) {
      ticket = new Ticket({
        status: true,
        subject: req.body.ticket.subject,
        complainer: req.currentUser.email,
        responder: req.currentUser.grader.email,
        complaints: [req.body.ticket.complaint],
        responses: [],
        date: new Date()
      });
      ticket.save(function(err) {
        log(err);
        res.redirect('/feedback');
      });
    }
  });
});
// TODO: error checking
app.post('/feedback/appeal/:ticketId', checkPermit('canAccessDashboard'), function(req, res) {
  trace('POST /feedback/appeal/:ticketId');
  req.sanitize('ticket', 'complaint', 'entityEncode');
  sendFeedbackEmail(req, function(err){
    if (!err) {
      req.ticket.date = new Date();
      req.ticket.complaints.push(req.body.ticket.complaint);
      req.ticket.status = true;
      req.ticket.save(function(err) {
        log(err);
        res.redirect('/feedback');
      });
    }
  });
});
/** Redirect everything else back to default if logged in. */
app.get('*', function(req, res) {
  trace('GET URL: ' + req.url);
  req.flash('error', "Whoops! The url you just went to does not exist.");
  res.redirect('/default');
});

// TODO: Search function

/** Start server. */
var port = process.env.PORT || 8086;
app.listen(port);
