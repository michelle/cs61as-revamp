/** debug flags. */
var DEBUG_ERR = true;
var DEBUG_TRACE = true;
var DEBUG_USER = true;
var DEBUG_HACK = true;

/** Default cookie lifetime is 1 day. */
var COOKIE_LIFETIME = 1000 * 60 * 60 * 24;

/** Setting up dependencies. */
var express = require('express');
var app = module.exports = express.createServer();
var mongoose = require('mongoose');
var mongoStore = require('connect-mongodb');
var schema = require('./schema.js');
var fs = require('fs');

/** Database. */
var db;
var GUEST;

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
/** Default guest user. */
GUEST = new User({
  username: 'Guest',
  permission: schema.permissions.Guest
});

/** Set up server, session management. */
app.use(express.favicon(__dirname + '/public/favicon.ico', {
  maxAge: 2592000000
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

function log(obj) {
  if(obj) {
    if( obj instanceof User) {
      if(DEBUG_USER) {
        console.log(obj);
      }
    } else if( obj instanceof Error) {
      if(DEBUG_ERR) {
        console.log(obj);
      }
    } else {
      if(DEBUG_HACK) {
        console.log(obj);
      }
    }
  }
}

function trace(msg) {
  if (DEBUG_TRACE && msg) {
    console.log(msg);
  }
}

/** Set current user if logged in.
 *  Set current user to GUEST and redirect to /home if not logged in.
 *  Redirect to /home if err. */
function loadUser(req, res, next) {
  trace('TRACE: loadUser');
  req.currentUser = GUEST;
  if (req.session.user_id) {
    loadUserFromSession(req, res, next);
  } else {
    loadUserFromCookie(req, res, next);
  }
}

function loadUserFromSession(req, res, next) {
  User.findById(req.session.user_id, function(err, user) {
    trace('TRACE: loadUserFromSession');
    if (err) {
      log(err);
      log('WARNING: session is in incorrect state: %s.', req.session);
      res.redirect('/home');
    } else {
     req.currentUser = user;
     log(req.currentUser);
     next();
    }
  });
}

function loadUserFromCookie(req, res, next) {
  var cookie = req.cookies['rememberme'] && JSON.parse(req.cookies['rememberme']);
  if (!cookie || !cookie.username || !cookie.series || !cookie.token) {
    log(req.currentUser);
    next();
    return;
  }
  trace('TRACE: loadUserFromCookie');

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
        log('WARNING: Cookie tampering attempt detected for user: %s', cookie.username);

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
 *  Redirect to /home if err. */
function loadLesson(req, res, next) {
  trace('TRACE: loadLesson');
  Lesson.findOne({
    number: req.currentUser.currentLesson
  }, function(err, lesson) {
    if (err) {
      log(err);
      log("WARNING: User %s's currentLesson is corrupted.", req.currentUser.currentLesson);
      req.flash('error', 'Looks like there is something wrong with your account. Please see an administrator.');
      res.redirect('/home');
    } else {
      req.currentLesson = lesson;
      Progress.findOne({ lesson: req.currentLesson, user: req.currentUser }, function (err, progress) {
        log(err);
        if (progress) {
          req.currentProgress = progress;
          next();
        } else {
          var progress = new Progress({
            lesson: req.currentLesson,
            user: req.currentUser,
            videos: req.currentLesson.videos.map(function (videos) { return false }),
            assignments: req.currentLesson.assignments.map(function (assignment) { return false }),
            readings: req.currentLesson.readings.map(function (reading) { return false })
          })
          req.currentProgress = progress;
          if (req.currentUser.canWriteProgress()) {
            progress.save(function (err){
              log(err);
              next();
            });
          } else {
            next();
          }
        }
      });
    }
  });
}

/** Make a middleware that only allows user with a PERMIT. */
function checkPermit(permit, sameuser) {
  return function(req, res, next) {
    trace('TRACE: checkPermit');
    if (req.currentUser[permit]() || (sameuser && sameuser(req, res))) {
      next();
    } else {
      req.flash('error', "Looks like you don't have the required permissions to access this page.");
      res.redirect('/');
    }
  }
}

/** An override to check if it's the same user base on IDENTIFICATION and PERMIT.
 *  Defaults method to check is username.
 *  Always return false for guest. */
function sameUser(permit, identification) {
  return function(req, res) {
    trace('TRACE: sameUser');
    if (!identification) {
      identification = 'username';
    }
    return req.currentUser != GUEST && req.currentUser[identification] == req.params[identification] && req.currentUser[permit]();
  }
}

/** Pre condition param userId into req.user. */
app.param('userId', function(req, res, next, userId) {
  trace('TRACE: param userId');
  User.findById(userId, function(err, user) {
    log(err);
    if (!err && user) {
      req.user = user;
    } else {
      req.user = null;
    }
    next();
  });
});
/** Pre condition param username into req.user. */
app.param('username', function(req, res, next, username) {
  trace('TRACE: param username');
  User.findOne({
    username: username
  }, function(err, user) {
    log(err);
    if(!err && user) {
      req.user = user;
    } else {
      req.user = null;
    }
    next();
  });
});
/** Pre condition param lessonId into req.lesson. */
app.param('lessonId', function(req, res, next, lessonId) {
  trace('TRACE: param lessonId');
  Lesson.findOne({
    number: lessonId
  }, function(err, lesson) {
    log(err);
    if (!err && lesson) {
      req.lesson = lesson;
    } else {
      req.lesson = null;
    }
    next();
  });
});
/** Pre condition param videoId into req.video. */
app.param('videoId', function(req, res, next, videoId) {
  trace('TRACE: param videoId');
  req.video = req.lesson.videos[videoId] || null;
  next();
});
/** Defaults for each state. */
app.get('/default', loadUser, function(req, res) {
  trace('TRACE: GET /default');
  if (req.currentUser.canAccessDashboard()) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/home');
  }
});
/** Default view iff logged in. */
app.get('/', loadUser, function(req, res) {
  trace('TRACE: GET /');
  if (req.currentUser.canAccessDashboard()) {
    res.redirect('/dashboard');
  } else {
    res.redirect('/home');
  }
});
/** Default view iff not logged in. */
app.get('/home', function(req, res) {
  trace('TRACE: GET /home');
  res.render('index', {
    page: 'home',
    // TODO: change this to accept currentUser (or GUEST)
    user: new User()
  });
});
/** Guest login. */
app.get('/guest', function(req, res) {
  trace('TRACE: GET /guest');
  res.redirect('/lessons');
});
/** A standard login post request. */
app.post('/login', function(req, res) {
  trace('TRACE: POST /login');
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
            res.redirect('/dashboard');
          });
        });
      } else {
        res.redirect('/dashboard');
      }
    } else {
      req.flash('error', 'Invalid username or password.');
      res.redirect('/home');
    }
  });
});
/** Logging out. */
app.get('/logout', loadUser, function(req, res) {
  trace('TRACE: GET /logout');
  if (req.session) {
    LoginToken.remove({ username: req.currentUser.username }, function() {});
    res.clearCookie('rememberme');
    req.flash('info', 'Logged out successfully!');
    req.session.destroy(function(err) {
      log(err);
    });
  }
  // TODO: How to get flash to work if session is destroyed?
  res.redirect('/home');
});
/** Admin Control Panel. */
app.get('/admin', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('TRACE: GET /admin');
  res.render('admin', {
    page: 'admin/index',
    currentUser: req.currentUser
  });
});
/** Manage users. */
app.get('/admin/users', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('TRACE: GET /admin/users');
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
app.post('/admin/users/add', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('TRACE: POST /admin/users/add');
  var user = new User({
    username: req.body.user.username,
    email: req.body.user.email,
  });
  user.password = req.body.user.password;
  user.save(function(err) {
    log(err);
    User.find({}, function(err, users) {
      log(err);
      res.render('admin/users', {
        page: 'admin/users/index',
        currentUser: req.currentUser,
        users: users
      });
    });
  });
});
/** Edit an user. */
app.get('/admin/users/edit/:userId', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('TRACE: GET /admin/users/edit/:userId');
  if (req.user) {
    res.render('admin/users/edit', {
      page: 'admin/users/edit',
      currentUser: req.currentUser,
      user: req.user
    });
  } else {
    req.flash('Error', 'Malformed userID.');
    res.redirect('/admin/users');
  }
});
/** Save edit an user. */
app.post('/admin/users/edit/:userId', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('TRACE: POST /admin/users/edit/:userId');
  if (req.user) {
    req.user.username = req.body.user.username;
    req.user.email = req.body.user.email;
    req.user.password = req.body.user.password;
    req.user.permission = req.body.user.permission;
    req.user.save(function(err){
      log(err);
      req.flash('info', 'User %s is saved sucessfully.', req.user.username);
      res.render('admin/users/edit', {
        page: 'admin/users/edit',
        currentUser: req.currentUser,
        user: req.user
      });
    });
  } else {
    req.flash('Error', 'Malformed userID.');
    res.redirect('/admin/users');
  }
});
/** Enter grades. */
// TODO: Determine how to organize assignments so that all are shown and then can be saved into grades.
app.get('/admin/grades', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('TRACE: GET /admin/grades');
  res.render('admin/grades', {
    page: 'admin/grades',
    currentUser: req.currentUser,
  });
});
/** Post grades. */
app.post('/admin/grades', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  trace('TRACE: GET /admin/grades');
});
/** Student dashboard. */
app.get('/dashboard', loadUser, loadLesson, checkPermit('canAccessDashboard'), function(req, res) {
  trace('TRACE: GET /dashboard');
  res.render('dashboard', {
    page: 'dashboard',
    currentUser: req.currentUser,
    currentLesson: req.currentLesson
  });
});
/** Viewing user profiles. */
app.get('/user/:username', loadUser, checkPermit('canReadUserInfoEveryone', sameUser('canReadUserInfo')), function(req, res) {
  trace('TRACE: GET /user/:username');
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
    res.redirect('/dashboard');
  }
});
/** Settings page. */
// TODO: Allow users to change their unit preferences, password, email, etc
// (maybe profile options if time).
app.get('/settings', loadUser, checkPermit('canWriteUserInfo'), function(req, res) {
  trace('TRACE: GET /settings');
  res.render('settings', {
    page: 'settings',
    currentUser: req.currentUser
  });
});
/** Collective lessons. */
app.get('/lessons', loadUser, checkPermit('canReadLesson'), function(req, res) {
  trace('TRACE: GET /lessons');
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
 *  Only displays progress control when the user has permission. */
app.get('/webcast', loadUser, loadLesson, checkPermit('canReadLesson'), function(req, res) {
  trace('TRACE: GET /webcast');
  if (req.currentLesson.videos) {
    res.render('video', {
      page: 'webcast',
      currentUser: req.currentUser,
      currentLesson: req.currentLesson,
      videos: req.currentLesson.videos,
      // TODO: implement controls so the user can mark a webcast as watched or not
      // watched.
      showControls: req.currentUser.canWriteProgress
    });
  } else {
    req.flash('error', 'Whoops! webcast for this lesson does not exist.');
    res.redirect('/lessons');
  }
});
/** Viewing webcast at LESSONID.
 *  Only displays progress control when the user has permission. */
app.get('/webcast/:lessonId', loadUser, checkPermit('canReadLesson'), function(req, res) {
  trace('TRACE: GET /webcast/:lessonId');
  if (req.lesson) {
    req.currentUser.currentLesson = req.lesson.number;
    req.currentUser.save(function(err) {
      log(err);
      res.render('video', {
        page: 'webcast',
        currentUser: req.currentUser,
        currentLesson: req.lesson,
        videos: req.lesson.videos,
        // TODO: implement progress controls
        showControls: req.currentUser.canWriteProgress
      });
    });
  } else {
    req.flash('error', 'Whoops! Webcast for this lesson does not exist.');
    res.redirect('/lessons');
  }
});
/** Viewing webcast by its URL. */
app.get('/webcast/:lessonId/:videoId', loadUser, checkPermit('canReadLesson'), function(req, res) {
  trace('TRACE: GET /webcast/:lessonId/:videoId');
  if(req.video) {
    req.currentUser.currentLesson = req.lesson.number;
    req.currentUser.save(function(err) {
      log(err);
      res.render('video', {
        page: 'webcast',
        currentUser: req.currentUser,
        currentLesson: req.lesson,
        videos: [req.video],
        showControls: req.currentUser.canWriteProgress
      });
    });
  } else {
    req.flash('error', 'Whoops! Webcast does not exist.');
    res.redirect('/lessons');
  }
});
/** Homework.
 *  Defaults: display the one specified by currentUser.currentLesson.
 *  Only displays progress control when the user has permission. */
app.get('/homework', loadUser, loadLesson, checkPermit('canReadLesson'), function(req, res) {
  trace('TRACE: GET /homework');
  if (req.currentLesson) {
    res.render('homework', {
      page: 'homework',
      currentUser: req.currentUser,
      currentLesson: req.currentLesson,
      // TODO: implement progress controls
      showControls: req.currentUser.canWriteProgress
    });
  } else {
    req.flash('error', 'Whoops! Homework for this lesson does not exist.');
    res.redirect('/lessons');
  }
});
/** View homework at LESSONID.
 *  Only displays progress control when the user has permission. */
app.get('/homework/:lessonId', loadUser, checkPermit('canReadLesson'), function(req, res) {
  trace('TRACE: GET /homework/:lessonId');
  if (req.lesson) {
    req.currentUser.currentLesson = req.lesson.number;
    req.currentUser.save(function(err) {
      log(err);
      res.render('homework', {
        page: 'homework',
        currentUser: req.currentUser,
        currentLesson: req.lesson,
        // TODO: implement progress controls
        showControls: req.currentUser.canWriteProgress
      });
    });
  } else {
    req.flash('error', 'Whoops! Homework for this lesson does not exist.');
    res.redirect('/lessons');
  }
});
/** Announcements. */
// TODO: Integrate Wordpress to post updates.
// TODO: figure out permission for this blog feature.
app.get('/blog', loadUser, function(req, res) {
  trace('TRACE: GET /blog');
});
/** Administration. */
// TODO: Compile administrative documents onto a static page.
// TODO: figure out permission for this static administration feature.
app.get('/administration', loadUser, function(req, res) {
  trace('TRACE: GET /administration');
});
/** Redirect everything else back to dashboard if logged in. */
app.get('*', function(req, res) {
  req.flash('error', "Whoops! The url you just went to does not exist.");
  res.redirect('/default');
});
// TODO: Search function

/** Start server. */
var port = process.env.PORT || 8086;
app.listen(port);
