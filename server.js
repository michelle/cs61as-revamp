/** debug flags. */
var DEBUG_ERR = true;
var DEBUG_TRACE = true;
var DEBUG_USER = false;
var DEBUG_WARNING = true;

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
  app.Video = Video = mongoose.model('Video');
  app.Reading = Reading = mongoose.model('Reading');
  app.Assignment = Assignment = mongoose.model('Assignment');
  app.Lesson = Lesson = mongoose.model('Lesson');
  app.LoginToken = LoginToken = mongoose.model('LoginToken');
  app.Grade = Grade = mongoose.model('Grade');
  app.Progress = Progress = mongoose.model('Progress');
  db = mongoose.connect(app.set('db-uri'));
});

/** Default unauthenticated user. */
var GUEST = new User({
  username: 'Guest',
  permission: schema.permissions.Guest
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
      return schema.permissions.Grader;
    case('Student'):
      return schema.permissions.User;
    case('Instructor'):
      return schema.permissions.Instructor;
    default:
      return schema.permissions.Guest;
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
  User.findById(req.session.user_id, function(err, user) {
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
        }, function(err, user) {
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
      // TODO: fail gracefully. reset currentLesson.
      // ERROR 102: currentLesson points to an invalid lesson.
      log("WARNING: User " + req.currentUser.username + "'s currentLesson is corrupted: " + req.currentUser.currentLesson);
      req.flash('error', 'ERROR 102: Looks like there is something wrong with your account. Please see an administrator.');
      res.redirect('/home');
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

    req.currentLesson.attachProgress(function() {
      return progress.assignments[0];
    });
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

/** Pre condition param userId into req.user. */
app.param('userId', function(req, res, next, userId) {
  trace('param userId');
  User.findById(userId, function(err, user) {
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
/** Manage users. */
app.get('/admin/users', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canReadUserInfoEveryone'), function(req, res) {
  trace('GET /admin/users');
  User.find({}, function(err, users) {
    log(err);
    res.render('admin/users', {
      page: 'admin/users/index',
      currentUser: req.currentUser,
      users: users
    });
  });
});
/** Add an user. */
app.post('/admin/users/add', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canWriteUserInfoEveryone'), function(req, res) {
  trace('POST /admin/users/add');
  var user = new User({
    username: req.body.user.username,
    email: req.body.user.email,
  });
  user.password = req.body.user.password;
  user.permission = getType(req.body.user.type);
  user.save(function(err) {
    if (err) {
      log(err);
      for (var e in err.errors) {
        req.flash('error', err.errors[e].message);
      }
      if (err.err) {
        req.flash('error', err.err);
      }
      req.flash('error', 'User %s was not added successfully.', user.username);
    } else {
      req.flash('info', 'User %s was added successfully.', user.username);
    }
    res.redirect('/admin/users');
  });
});
/** Edit an user. */
app.get('/admin/users/edit/:userId', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canReadUserInfoEveryone'), function(req, res) {
  trace('GET /admin/users/edit/:userId');
  if (req.user) {
    res.render('admin/users/edit', {
      page: 'admin/users/edit',
      currentUser: req.currentUser,
      user: req.user
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
    req.user.username = req.body.user.username;
    if (req.body.user.password != '') {
      req.user.password = req.body.user.password;
    }
    req.user.email = req.body.user.email;
    req.user.currentLesson = req.body.user.currentLesson;
    req.user.units = req.body.user.units;
    req.user.permission = req.body.user.permission;
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
      res.render('admin/users/edit', {
        page: 'admin/users/edit',
        currentUser: req.currentUser,
        user: req.user
      });
    });
  } else {
    req.flash('error', 'Malformed userID.');
    res.redirect('/admin/users');
  }
});
/** Manage grades. */
app.get('/admin/grades', loadUser, checkPermit('canAccessAdminPanel'), checkPermit('canReadGradeEveryone'), function(req, res) {
  trace('GET /admin/grades');
  User.find({}, function(err, users) {
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
  res.render('dashboard', {
    page: 'dashboard',
    currentUser: req.currentUser,
    currentLesson: req.currentLesson
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
/** Webcast viewing.
 *  Default: display the one specified by currentUser.currentLesson.
 *  Only displays progress control when the user has permission. 
app.get('/webcast', loadUser, checkPermit('canReadLesson'), loadLesson, loadProgress, function(req, res) {
  trace('GET /webcast');
  if (req.currentLesson.videos) {
    res.render('video', {
      page: 'webcast',
      currentUser: req.currentUser,
      currentLesson: req.currentLesson,
      videos: req.currentLesson.videos,
      showControls: req.currentUser.canWriteProgress
    });
  } else {
    req.flash('error', 'Whoops! webcast for this lesson does not exist.');
    res.redirect('/default');
  }
});
Viewing webcast at LESSONID.
 *  Only displays progress control when the user has permission. 
app.get('/webcast/:lessonId', loadUser, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /webcast/:lessonId');
  if (req.currentLesson) {
    req.currentUser.currentLesson = req.currentLesson.number;
    req.currentUser.save(function(err) {
      log(err);
      res.render('video', {
        page: 'webcast',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
        videos: req.currentLesson.videos,
        showControls: req.currentUser.canWriteProgress
      });
    });
  } else {
    req.flash('error', 'Whoops! Webcast for this lesson does not exist.');
    res.redirect('/default');
  }
});*/
/** Viewing webcast by its URL. */
app.get('/webcast/:lessonId/:videoId', loadUser, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /webcast/:lessonId/:videoId');
  if(req.currentLesson && req.video) {
    req.currentUser.currentLesson = req.currentLesson.number;
    req.currentUser.save(function(err) {
      log(err);
      console.log(req.video.isCompleted);
      res.render('video', {
        page: 'webcast',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
        videoId: req.params.videoId,
        videos: [req.video],
        showControls: req.currentUser.canWriteProgress
      });
    });
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
/** Marking reading as read. */
app.post('/reading/:lessonId/:readingId', loadUser, checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /reading/:lessonId/:readingId');
  var reading = req.currentLesson.readings[req.params.readingId];
  if(req.currentLesson && reading) {
    reading.isCompleted = true;
    res.redirect('/dashboard');
  } else {
    req.flash('error', 'Whoops! Reading does not exist.');
    res.redirect('/dashboard');
  }
});
/** Marking homework as complete. */
app.post('/homework/:lessonId', loadUser, checkPermit('canWriteProgress'), loadProgress, function(req, res) {
  trace('POST /homework/:lessonId');
  if(req.currentLesson && req.currentLesson.homework) {
    req.currentLesson.homework.isCompleted = true;
    res.redirect('/dashboard');
  } else {
    req.flash('error', 'Whoops! Homework does not exist.');
    res.redirect('/dashboard');
  }
});
/** Viewing reading. */
app.get('/reading/:lessonId/:readingId', loadUser, checkPermit('canReadLesson'), loadProgress, function(req, res) {
  trace('GET /reading/:lessonId/:readingId');
  // TODO: iframe view for SICP readings.
  if (req.currentLesson && req.currentLesson.readings) {
    req.currentUser.currentLesson = req.currentLesson.number;
    var reading = req.currentLesson.readings[req.params.readingId];
    req.currentUser.save(function(err) {
      log(err);
      res.render('reading', {
        page: 'reading',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
        reading: reading,
        readingId: req.params.readingId,
        // TODO: implement progress controls
        showControls: req.currentUser.canWriteProgress
      });
    });
  } else {
    req.flash('error', 'Whoops! This reading does not exist.');
    res.redirect('/default');
  }
});
/** Homework.
 *  Defaults: display the one specified by currentUser.currentLesson.
 *  Only displays progress control when the user has permission. */
app.get('/homework', loadUser, loadLesson, checkPermit('canReadLesson'), function(req, res) {
  trace('GET /homework');
  if (req.currentLesson && req.currentLesson.homework) {
    res.render('homework', {
      page: 'homework',
      currentUser: req.currentUser,
      currentLesson: req.currentLesson,
      // TODO: implement progress controls
      showControls: req.currentUser.canWriteProgress
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
    req.currentUser.save(function(err) {
      log(err);
      res.render('homework', {
        page: 'homework',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
        // TODO: implement progress controls
        showControls: req.currentUser.canWriteProgress
      });
    });
  } else {
    req.flash('error', 'Whoops! Homework for this lesson does not exist.');
    res.redirect('/default');
  }
});
/** Project.
 *  Defaults: display the one specified by currentUser.currentLesson.
 *  Only displays progress control when the user has permission. */
app.get('/project', loadUser, loadLesson, checkPermit('canReadLesson'), function(req, res) {
  trace('GET /project');
  if (req.currentLesson && req.currentLesson.project) {
    res.render('project', {
      page: 'project',
      currentUser: req.currentUser,
      currentLesson: req.currentLesson,
      // TODO: implement progress controls
      showControls: req.currentUser.canWriteProgress
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
    req.currentUser.save(function(err) {
      log(err);
      res.render('project', {
        page: 'project',
        currentUser: req.currentUser,
        currentLesson: req.currentLesson,
        // TODO: implement progress controls
        showControls: req.currentUser.canWriteProgress
      });
    });
  } else {
    req.flash('error', 'Whoops! Project for this lesson does not exist.');
    res.redirect('/default');
  }
});
/** Announcements. */
// TODO: Integrate Wordpress to post updates.
app.get('/blog', loadUser, checkPermit('canReadLesson'), function(req, res) {
  trace('GET /blog');
  res.send('Under construction. Please come back later.');
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

// TODO: Add labs to schema

// TODO: ATTACKING! Move everything to public so we can use filesystem to edit files.

/** Start server. */
var port = process.env.PORT || 8086;
app.listen(port);
