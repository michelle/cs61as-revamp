/** debug flags. */
var DEBUG_ERR = true;
var DEBUG_TRACE = true;
var DEBUG_USER = false;
var DEBUG_WARNING = true;

/** option flags. */
var SEND_GRADER_NOTIFICATION = false;

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

/** Database. */
var db;

/** Configuration. */
var config = JSON.parse(fs.readFileSync('private/config.conf'));

/** Flash message support. */
app.helpers(require('./dh.js').helpers);
app.dynamicHelpers(require('./dh.js').dynamicHelpers);

/** Student database URI. */
app.set('db-uri', 'mongodb://admin:scheme@staff.mongohq.com:10082/cs61as');

/** Database models. */
schema.defineModels(mongoose, function() {
  app.User = User = mongoose.model('User');
  app.Video = Video = mongoose.model('Video');
  app.Reading = Reading = mongoose.model('Reading');
  app.Assignment = Assignment = mongoose.model('Assignment');
  app.Lesson = Lesson = mongoose.model('Lesson');
  app.LoginToken = LoginToken = mongoose.model('LoginToken');
  app.Grade = Grade = mongoose.model('Grade');
  app.Progress = Progress = mongoose.model('Progress');
  app.Announcement = Announcement = mongoose.model('Announcement');
  db = mongoose.connect(app.set('db-uri'));
});

/** Default unauthenticated user. */
var GUEST = new User({
  username: 'Guest',
  permission: User.Permissions.Guest
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

/** Where to look for templates. */
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// setting up SMTP information
nodemailer.SMTP = config.SMTP;

/** Log OBJ to console bases on the type of OBJ and debug flags.*/
function log(obj) {
  if (obj) {
    if (obj instanceof User) {
      if (DEBUG_USER) {
        console.log(obj);
      }
    } else if (obj instanceof Error) {
      if (DEBUG_ERR) {
        console.log(obj);
      }
    } else {
      if (DEBUG_WARNING) {
        console.log(obj);
      }
    }
  }
}

/** Print a debug trace MSG.*/
function trace(msg) {
  if (DEBUG_TRACE && msg) {
    console.log('TRACE: %s', msg);
  }
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
      log(req.currentUser);
      next();
    } else {
      log(req.currentUser);
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
    log(req.currentUser);
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
              log(req.currentUser);
              next();
            });
          } else {
            log(req.currentUser);
            next();
          }
        });
      }
    } else {
      res.clearCookie('rememberme');
      log(req.currentUser);
      next();
    }
  });
}

/** Set current lesson to the one specified by currentUser.currentLesson.
 *  Redirect to /home if currentUser.currentLesson points to an invalid lesson. */
function loadLesson(req, res, next) {
  trace('loadLesson');
  Lesson.findOne({
    number: req.currentUser.currentLesson
  }, function(err, lesson) {
    log(err);
    if (lesson) {
      req.currentLesson = lesson;
      next();
    } else {
      req.currentUser.currentLesson = 1;
      req.currentUser.save(function(err) {
        log(err);
        log("WARNING: User " + req.currentUser.username + "'s currentLesson is corrupted: " + req.currentUser.currentLesson);
        req.flash('error', 'Looks like there is something wrong with your account. If the problem persists, please contact administrators.');
        res.redirect('/default');
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
    if (!progress) {
      progress = new Progress({
        lesson: req.currentLesson,
        user: req.currentUser,
        videos: req.currentLesson.videos.map(function (videos) { return false }),
        assignments: req.currentLesson.assignments.map(function (assignment) { return false }),
        extra: req.currentLesson.extra.map(function (extra) { return false }),
        readings: req.currentLesson.readings.map(function (reading) { return false })
      });
      if (req.currentUser.canWriteProgress()) {
        progress.save(function (err){
          log(err);
        });
      }
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
    for(var i = 0; i < req.currentLesson.assignments.length; i++) {
      req.currentLesson.assignments[i].attachProgress( function(id) {
        return function(value) {
          if (req.currentUser.canWriteProgress()) {
            progress.assignments[id] = value;
            progress.markModified('assignments');
            progress.save(function (err) {
              log(err);
            });
          }
        }
      }(i), function(id) {
        return function() {
          return progress.assignments[id];
        }
      }(i));
    }
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
      }(i));O
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
    next();
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
      req.flash('error', "Looks like you don't have the required permissions to access " + req.url);
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


function sendGraderNotification(req, next) {
  if (!SEND_GRADER_NOTIFICATION) {
    req.flash('info', "Grader notification is not sent because option flag is off.");
    next();
    return;
  }
  var html = "<p>You receive a grade request from " + req.currentUser.username
           + " regarding homework " + req.currentLesson.number + " at "
           +  String(new Date())
           + ".<br /> If you receive this email in error. Please discard immediately.</p>";
  var body = "You receive a grade request from " + req.currentUser.username
           + " regarding homework " + req.currentLesson.number + " at "
           +  String(new Date())
           + ". If you receive this email in error. Please discard immediately.";

  nodemailer.send_mail({
    sender: 'astudent@somewhere.com',
    to: req.currentUser.grader.email,
    subject: 'Grade request from student: ' + req.currentUser.username,
    html: html,
    body: body
  }, function(err, success) {
    if(err) {
      log(err)
      req.flash('error', "ERROR 103: Email to grader not sent! Please contact administrators.");
      next(new Error("wrong smtp information"));
      return;
    }
    if(success) {
      req.flash('info', "Your grader is notified of your submission. Any submission after this period is discarded.");
      next();
    } else {
      req.flash('error', "ERROR 104: Email to grader not sent! Please contact administrators.");
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
/** Pre condition param noteId into req.note. */
app.param('noteId', function(req, res, next, noteId) {
  trace('param noteId');
  Announcement.findById(noteId, function(err, note) {
    log(err);
    req.note = !err && note;
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
/** Pre condition param lessonId into req.lesson. */
app.param('lessonId', function(req, res, next, lessonId) {
  trace('param lessonId');
  Lesson.findOne({
    number: lessonId
  }, function(err, lesson) {
    log(err);
    req.currentLesson = !err && lesson;
    next();
  });
});
/** Pre condition param lessonId into req.lesson. */
app.param('gradeId', function(req, res, next, gradeId) {
  trace('param gradeId');
  req.grade = req.user.grades && req.user.grades.id(gradeId)
  next();
});
/** Pre condition param videoId into req.video. */
app.param('videoId', function(req, res, next, videoId) {
  trace('param videoId');
  req.video = req.currentLesson.videos && req.currentLesson.videos[videoId];
  next();
});
/** Pre condition param readingId into req.reading. */
app.param('readingId', function(req, res, next, readingId) {
  trace('param readingId');
  req.reading = req.currentLesson.readings && req.currentLesson.readings[readingId];
  next();
});
/** Defaults for each type of user. */
app.get('/default', loadUser, function(req, res) {
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
app.get('/', loadUser, function(req, res) {
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
            req.flash('info', 'Logged in successfully as ' + user.username);
            res.redirect('/default');
          });
        });
      } else {
        req.flash('info', 'Logged in successfully as ' + user.username);
        res.redirect('/default');
      }
    } else {
      req.flash('error', 'Invalid username or password.');
      res.redirect('/home');
    }
  });
});
/** Logging out. */
app.get('/logout', loadUser, function(req, res) {
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
app.get('/admin', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('GET /admin');
  res.render('admin', {
    page: 'admin/index',
    currentUser: req.currentUser
  });
});
/** Announcements panel */
app.get('/admin/announcements', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/announcements');
  Announcement.find({}, function(err, news) {
    log(err);
    res.render('admin/announcements', {
      page: 'admin/announcements',
      currentUser: req.currentUser,
      news: news
    });
  });
});
/** Post new announcement */
app.post('/admin/announcements/new', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/announcement/new');
  var announcement = new Announcement({
    title: req.body.announcement.title,
    content: req.body.announcement.content,
    date: new Date()
  });
  announcement.save(function(err) {
    if (err) {
      log(err);
      for (var e in err.errors) {
        req.flash('error', err.errors[e].message);
      }
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
app.get('/admin/announcements/edit/:noteId', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('GET /admin/announcements/edit/:noteId');
  if (req.note) {
    res.render('admin/announcements/edit', {
      page: 'admin/announcements/edit',
      currentUser: req.currentUser,
      note: req.note
    });
  } else {
    req.flash('error', 'Malformed noteID.');
    res.redirect('/admin/announcements');
  }
});
/** Save edit a note. */
app.post('/admin/announcements/edit/:noteId', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('POST /admin/announcements/edit/:noteId');
  if (req.note) {
    req.note.title = req.body.note.title;
    if (req.body.note.content != '') {
      req.note.content = req.body.note.content;
    }
    req.note.date = new Date();
    req.note.save(function(err){
      if (err) {
        log(err);
        for (var e in err.errors) {
          req.flash('error', err.errors[e].message);
        }
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
app.get('/admin/announcements/delete/:noteId', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteLesson'), function(req, res) {
  trace('DEL /admin/announcements/delete/:noteId');
  if (req.note) {
    Announcement.findById(req.note.id, function(err, note) {
      log(err);
      note.remove();
      req.flash('info', 'Post deleted.');
      res.redirect('/admin/announcements');
    });
  } else {
    req.flash('error', 'Malformed noteID.');
    res.redirect('/admin/announcements');
  }
});
/** Manage users. */
app.get('/admin/users', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canReadUserInfoEveryone'), function(req, res) {
  trace('GET /admin/users');
  User.find({ permission: User.Permissions.Grader }, function(err, graders) {
    log(err);
    User.find({}, function(err, users) {
      log(err);
      res.render('admin/users', {
        page: 'admin/users/index',
        currentUser: req.currentUser,
        users: users,
        graders: graders
      });
    });
  });
});
/** Add an user. */
app.post('/admin/users/add', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteUserInfoEveryone'), function(req, res) {
  trace('POST /admin/users/add');
  var user = new User({
    username: req.body.user.username
  });
  user.email = req.body.user.email;
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
          for (var e in err.errors) {
            req.flash('error', err.errors[e].message);
          }
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
app.get('/admin/users/edit/:userId', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canReadUserInfoEveryone'), function(req, res) {
  trace('GET /admin/users/edit/:userId');
  if (req.user) {
    User.find({ permission: User.Permissions.Grader }, function(err, graders) {
      log(err);
        res.render('admin/users/edit', {
        page: 'admin/users/edit',
        currentUser: req.currentUser,
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
app.post('/admin/users/edit/:userId', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteUserInfoEveryone'), function(req, res) {
  trace('POST /admin/users/edit/:userId');
  if (req.user) {
    if (req.body.user.password != '') {
      req.user.password = req.body.user.password;
    }
    req.user.username = req.body.user.username;
    req.user.email = req.body.user.email;
    req.user.currentLesson = req.body.user.currentLesson;
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
            for (var e in err.errors) {
              req.flash('error', err.errors[e].message);
            }
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
/** Manage grades. */
app.get('/admin/grades', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canReadGradeEveryone'), function(req, res) {
  trace('GET /admin/grades');
  User.find({ permission: User.Permissions.Student }, function(err, users) {
    log(err);
    res.render('admin/grades/index', {
      page: 'admin/grades/index',
      currentUser: req.currentUser,
      users: users
    });
  });
});
/** Get grades from a user. */
app.get('/admin/grades/:username', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canReadGradeEveryone'), function(req, res) {
  trace('GET /admin/grades/:username');
  if(req.user) {
    res.render('admin/grades/user', {
      page: 'admin/grades/user',
      currentUser: req.currentUser,
      user: req.user
    });
  } else {
    req.flash('error', 'Whoops! User does not exist.');
    res.redirect('/default');
  }
});
/** Add a grade. */
app.post('/admin/grades/:username/add', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteGradeEveryone'), function(req, res) {
  trace('POST /admin/:username/add');
  req.user.grades.push({
    name: req.body.grade.name,
    order: req.body.grade.order,
    grade: req.body.grade.grade,
    weight: req.body.grade.weight
  });
  req.user.save(function(err) {
    if (err) {
      log(err);
      for (var e in err.errors) {
        req.flash('error', err.errors[e].message);
      }
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
app.get('/admin/grades/:username/:gradeId', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canReadGradeEveryone'), function(req, res) {
  trace('GET /admin/grades/:username/:gradeId');
  if(req.user && req.grade) {
    res.render('admin/grades/edit', {
      page: 'admin/grades/edit',
      currentUser: req.currentUser,
      user: req.user,
      grade: req.grade
    });
  } else {
    req.flash('error', 'Whoops! Grade does not exist.');
    res.redirect('/default');
  }
});
/** Edit a grade. */
app.post('/admin/grades/:username/:gradeId', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteGradeEveryone'), function(req, res) {
  trace('POST /admin/:username/:gradeId');
  req.grade.name = req.body.grade.name;
  req.grade.order = req.body.grade.order;
  req.grade.grade = req.body.grade.grade;
  req.grade.weight = req.body.grade.weight;
  req.user.save(function(err) {
    if (err) {
      log(err);
      for (var e in err.errors) {
        req.flash('error', err.errors[e].message);
      }
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'Grade is not saved.');
    } else {
      req.flash('info', 'Grade is saved!');
    }
    res.redirect('/admin/grades/' + req.user.username);
  });
});
/** Student dashboard. */
app.get('/dashboard', loadUser, checkPermit('canAccessDashboard'), loadLesson, loadProgress, function(req, res) {
  trace('GET /dashboard');
  Announcement.find({}, function(err, news) {
    log(err);
    news.sort(function(b, a) { return a.date - b.date } );
    res.render('dashboard', {
      page: 'dashboard',
      currentUser: req.currentUser,
      currentLesson: req.currentLesson,
      news: news
    });
  });
});
/** Viewing user profiles. */
// TODO: determine if user profiles should actually be kept.
app.get('/user/:username', loadUser, checkPermit('canReadUserInfoEveryone', sameUser('canReadUserInfo')), function(req, res) {
  trace('GET /user/:username');
  if(req.user) {
    res.render('profile', {
      page: 'profile',
      currentUser: req.currentUser,
      showGrades: req.currentUser.canReadGradeEveryone() || (req.currentUser == req.user && req.currentUser.canReadGrade()),
      showProgress: req.currentUser.canReadGradeEveryone() || (req.currentUser == req.user && req.currentUser.canReadProgress()),
      user: req.user
    });
  } else {
    req.flash('error', 'Whoops! User does not exist.');
    res.redirect('/default');
  }
});
/** Get grades for current user. */
app.get('/grades', loadUser, checkPermit('canReadGrade'), function(req, res) {
  trace('GET /grades');
  res.render('grades', {
    page: 'grades',
    currentUser: req.currentUser,
  });
});
/** Settings page. */
app.get('/settings', loadUser, checkPermit('canReadUserInfo'), function(req, res) {
  trace('GET /settings');
  res.render('settings', {
    page: 'settings',
    currentUser: req.currentUser
  });
});
/** Save edit an user. */
app.post('/settings', loadUser, checkPermit('canWritePassword'), function(req, res) {
  trace('POST /settings');
  if (req.currentUser.authenticate(req.body.user.password)) {
    if (req.body.user.newpassword != '') {
      if (req.body.user.newpassword === req.body.user.confirm) {
        req.currentUser.password = req.body.user.newpassword;
      } else {
        req.flash('error', 'User %s was not saved successfully because new passwords did not match.', req.currentUser.username);
        res.redirect('/settings');
        return;
      }
    }
    req.currentUser.email = req.body.user.email;
    req.currentUser.units = req.body.user.units;

    req.currentUser.save(function(err) {
      if (err) {
        log(err);
        for (var e in err.errors) {
          req.flash('error', err.errors[e].message);
        }
        if (err.err) {
          req.flash('error', 'Email is registered. Please use your email.');
        }
        req.flash('error', 'User %s was not saved successfully.', req.currentUser.username);
      } else {
        req.flash('info', 'User %s was saved successfully.', req.currentUser.username);
      }
      res.redirect('/settings');
    });
  } else {
    req.flash('error', 'Please enter your current password to make any changes.');
    res.redirect('/settings');
  }
});
/** Collective lessons. */
app.get('/lessons', loadUser, checkPermit('canReadLesson'), function(req, res) {
  trace('GET /lessons');
  Lesson.find({}, function(err, lessons) {
    log(err);
    res.render('lessons', {
      page: 'lessons',
      currentUser: req.currentUser,
      lessons: lessons
    });
  });
});
/** Viewing webcast by its URL. */
app.get('/webcast/:lessonId/:videoId', loadUser, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /webcast/:lessonId/:videoId');
  if(req.currentLesson && req.video) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        res.render('video', {
          page: 'webcast',
          currentUser: req.currentUser,
          currentLesson: req.currentLesson,
          videoId: req.params.videoId,
          videos: [req.video],
          showControls: req.currentUser.canWriteProgress()
        });
      });
    } else {
      res.render('video', {
        page: 'webcast',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
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
app.post('/webcast/:lessonId/:videoId', loadUser, checkPermit('canWriteProgress'), loadProgress, function(req, res) {
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
app.get('/reading/:lessonId/:readingId', loadUser, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /reading/:lessonId/:readingId');
  // TODO: iframe view for SICP readings.
  if (req.currentLesson && req.reading) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        res.render('reading', {
          page: 'reading',
          currentUser: req.currentUser,
          currentLesson: req.currentLesson,
          reading: req.reading,
          readingId: req.params.readingId,
          showControls: req.currentUser.canWriteProgress()
        });
      });
    } else {
      res.render('reading', {
        page: 'reading',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
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
/** Marking reading as read. */
app.post('/reading/:lessonId/:readingId', loadUser, checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /reading/:lessonId/:readingId');
  if(req.currentLesson && req.reading) {
    req.reading.isCompleted = true;
    res.redirect('/dashboard');
  } else {
    req.flash('error', 'Whoops! Reading does not exist.');
    res.redirect('/dashboard');
  }
});
/** Homework.
 *  Defaults: display the one specified by currentUser.currentLesson.
 *  Only displays progress control when the user has permission. */
app.get('/homework', loadUser, loadLesson, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /homework');
  if (req.currentLesson && req.currentLesson.homework) {
    res.render('homework', {
      page: 'homework',
      currentUser: req.currentUser,
      currentLesson: req.currentLesson,
      showControls: req.currentUser.canWriteProgress()
    });
  } else {
    req.flash('error', 'Whoops! Homework for this lesson does not exist.');
    res.redirect('/default');
  }
});
/** View homework at LESSONID.
 *  Only displays progress control when the user has permission. */
app.get('/homework/:lessonId', loadUser, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /homework/:lessonId');
  if (req.currentLesson && req.currentLesson.homework) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        res.render('homework', {
          page: 'homework',
          currentUser: req.currentUser,
          currentLesson: req.currentLesson,
          showControls: req.currentUser.canWriteProgress()
        });
      });
    } else {
      res.render('homework', {
        page: 'homework',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
        showControls: req.currentUser.canWriteProgress()
      });
    }
  } else {
    req.flash('error', 'Whoops! Homework for this lesson does not exist.');
    res.redirect('/default');
  }
});
/** Marking homework as complete. */
app.post('/homework/:lessonId', loadUser, checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /homework/:lessonId');
  if(req.currentLesson && req.currentLesson.homework) {
    if (req.body.confirm) {
      sendGraderNotification(req, function(err){
        if (!err) {
          req.currentLesson.homework.isCompleted = true;
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
/** View solution for TYPE at lessonId.
 *  Only displays progress control when the user has permission. */
app.get('/solutions/:type/:lessonId', loadUser, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /solutions/:type/:lessonId');
  if (['homework', 'extra'].indexOf(req.params.type) === -1) {
    req.flash('error', "Whoops! The url you just went to does not exist.");
    res.redirect('/default');
    return;
  }

  if (req.currentLesson && req.currentLesson[req.params.type]) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        if (req.currentLesson[req.params.type].isCompleted) {
          res.render('solution', {
            page: 'solution',
            currentUser: req.currentUser,
            type: req.params.type,
            currentLesson: req.currentLesson,
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
        currentUser: req.currentUser,
        type: req.params.type,
        currentLesson: req.currentLesson,
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
// TODO: view for projects
app.get('/project', loadUser, checkPermit('canReadLesson'), loadLesson, loadProgress, function(req, res) {
  trace('GET /project');
  if (req.currentLesson && req.currentLesson.project) {
    res.render('project', {
      page: 'project',
      currentUser: req.currentUser,
      currentLesson: req.currentLesson,
      showControls: req.currentUser.canWriteProgress()
    });
  } else {
    req.flash('error', 'Whoops! Project for this lesson does not exist.');
    res.redirect('/default');
  }
});
/** View project at LESSONID.
 *  Only displays progress control when the user has permission. */
app.get('/project/:lessonId', loadUser, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /project/:lessonId');
  if (req.currentLesson && req.currentLesson.project) {
    req.currentUser.currentLesson = req.currentLesson.number;
    if (req.currentUser.canWriteProgress()) {
      req.currentUser.save(function(err) {
        log(err);
        res.render('project', {
          page: 'project',
          currentUser: req.currentUser,
          currentLesson: req.currentLesson,
          showControls: req.currentUser.canWriteProgress()
        });
      });
    } else {
      res.render('project', {
        page: 'project',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
        showControls: req.currentUser.canWriteProgress()
      });
    }
  } else {
    req.flash('error', 'Whoops! Project for this lesson does not exist.');
    res.redirect('/default');
  }
});
/** Administration. */
// TODO: Compile administrative documents onto a static page.
app.get('/administration', loadUser, checkPermit('canReadLesson'), function(req, res) {
  trace('GET /administration');
  res.render('administration', {
    page: 'administration',
    currentUser: req.currentUser,
  });
});
/** Redirect everything else back to default if logged in. */
app.get('*', function(req, res) {
  trace('GET URL: ' + req.url);
  req.flash('error', "Whoops! The url you just went to does not exist.");
  res.redirect('/default');
});

// TODO: Search function

// TODO: Feedback

// TODO: Add labs and projects to schema

/** Start server. */
var port = process.env.PORT || 8086;
app.listen(port);
