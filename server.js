/** debug flags. */
var DEBUG_ERR = true;
var DEBUG_TRACE = true;
var DEBUG_USER = true;

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

/** Model for a User and a LoginToken that will be used for remembering
 * users who have logged in before. */
schema.defineModels(mongoose, function() {
  app.User = User = mongoose.model('User');
  app.Video = Video = mongoose.model('Video');
  app.Reading = Reading = mongoose.model('Reading');
  app.Assignment = Assignment = mongoose.model('Assignment');
  app.Lesson = Lesson = mongoose.model('Lesson');
  app.LoginToken = LoginToken = mongoose.model('LoginToken');
  app.Grade = Grade = mongoose.model('Grade');
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

/** Set current user if logged in.
 *  Set current user to GUEST and redirect to /home if not logged in.
 *  Redirect to /home if err. */
function loadUser(req, res, next) {
  if (DEBUG_TRACE) {
    console.log('TRACE: loadUser');
  }
  req.currentUser = GUEST;
  if (req.session.user_id) {
    User.findById(req.session.user_id, function(err, user) {
      if (err) {
        if (DEBUG_ERR) {
          console.log('WARNING: session is in incorrect state: %s.\n%s', req.session, err);
        }
        res.redirect('/home');
      }
      req.currentUser = user;
      if (DEBUG_USER) {
        console.log(req.currentUser);
      }
      next();
    });
  } else {
    if (DEBUG_USER) {
      console.log(req.currentUser);
    }
    next();
  }
}

/** Set current lesson to currentUser.progress.
 *  Redirect to /home if err. */
function loadLesson(req, res, next) {
  if (DEBUG_TRACE) {
    console.log('TRACE: loadLesson');
  }
  Lesson.findOne({
    number: req.currentUser.progress
  }, function(err, lesson) {
    if (err) {
      if (DEBUG_ERR) {
        console.log("WARNING: User %s's progress is corrupted.\n%s", req.currentUser.progress, err);
      }
      req.flash('error', 'Looks like there is something wrong with your account. Please see an administrator.');
      res.redirect('/home');
    }
    req.currentLesson = lesson;
    next();
  });
}

/** Make a middleware that only allows user with a PERMIT. */
function checkPermit(permit, sameuser) {
  return function(req, res, next) {
    if (DEBUG_TRACE) {
      console.log('TRACE: checkPermit');
    }
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
    if (DEBUG_TRACE) {
      console.log('TRACE: sameUser');
    }
    if (!identification) {
      identification = 'username';
    }
    return req.currentUser != GUEST && req.currentUser[identification] == req.params[identification] && req.currentUser[permit]();
  }
}

/** Pre condition param userId into req.user. */
app.param('userId', function(req, res, next, userId) {
  if (DEBUG_TRACE) {
    console.log('TRACE: param userId');
  }
  User.findById(userId, function(err, user) {
    if (DEBUG_ERR && err)
      console.log(err);
    if (!err && user) {
      req.user = user;
    } else {
      req.user = null;
    }
    next();
  });
});
/** Pre condition param lessonId into req.lesson. */
app.param('lessonId', function(req, res, next, lessonId) {
  if (DEBUG_TRACE) {
    console.log('TRACE: param lessonId');
  }
  Lesson.findOne({
    number: lessonId
  }, function(err, lesson) {
    if (DEBUG_ERR && err)
      console.log(err);
    if (!err && lesson) {
      req.lesson = lesson;
    } else {
      req.lesson = null;
    }
    next();
  });
});
/** Default view iff logged in. */
app.get('/', loadUser, function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /');
  }
  if (req.currentUser.canAccessDashboard()) {
    res.redirect('/dashboard');
  } else if (req.currentUser.canReadLesson()) {
    res.redirect('/lessons');
  } else {
    res.redirect('/home');
  }
});
/** Default view iff not logged in. */
app.get('/home', function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /home');
  }
  res.render('index', {
    page: 'home',
    // TODO: change this to accept currentUser (or GUEST)
    user: new User()
  });
});
/** Guest login. */
app.get('/guest', function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /guest');
  }
  res.redirect('/lessons');
});
/** A standard login post request. */
app.post('/login', function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: POST /login');
  }
  User.findOne({
    username: req.body.user.username
  }, function(err, user) {
    if (DEBUG_ERR && err)
      console.log(err);
    if (user && user.authenticate(req.body.user.password)) {
      req.session.user_id = user._id;
      res.redirect('/dashboard');
    } else {
      req.flash('error', 'Invalid username or password.');
      res.redirect('/home');
    }
  });
});
/** Logging out. */
app.get('/logout', loadUser, function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /logout');
  }
  if (req.session) {
    // LoginToken.remove({ username: req.currentUser.username }, function() {});
    //res.clearCookie('logintoken');
    req.flash('info', 'Logged out successfully!');
    req.session.destroy(function(err) {
      if (DEBUG_ERR && err)
        console.log(err);
    });
  }
  // TODO: How to get flash to work if session is destroyed?
  res.redirect('/home');
});
/** Admin Control Panel. */
app.get('/admin', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /admin');
  }
  res.render('admin', {
    page: 'admin/index',
    currentUser: req.currentUser
  });
});
/** Manage users. */
app.get('/admin/users', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /admin/users');
  }
  User.find({}, function(err, users) {
    if (DEBUG_ERR && err)
      console.log(err);
    res.render('admin/users', {
      page: 'admin/users/index',
      currentUser: req.currentUser,
      users: users
    });
  });
});
/** Add an user. */
app.post('/admin/users/add', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: POST /admin/users/add');
  }
  var user = new User({
    username: req.body.user.username,
    email: req.body.user.email,
  });
  user.password = req.body.user.password;
  user.save(function(err) {
    if (DEBUG_ERR && err)
      console.log(err);
  });
  User.find({}, function(err, users) {
    if (DEBUG_ERR && err)
      console.log(err);
    res.render('admin/users', {
      page: 'admin/users/index',
      currentUser: req.currentUser,
      users: users
    });
  });
});
/** Edit an user. */
app.get('/admin/users/edit/:userId', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /admin/users/edit/:userId');
  }
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
  if (DEBUG_TRACE) {
    console.log('TRACE: POST /admin/users/edit/:userId');
  }
  if (req.user) {
    req.user.username = req.body.user.username;
    req.user.email = req.body.user.email;
    req.user.password = req.body.user.password;
    req.user.permission = req.body.user.permission;
    req.user.save();
    req.flash('info', 'User %s is saved sucessfully.', req.user.username);
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
/** Enter grades. */
// TODO: Determine how to organize assignments so that all are shown and then can be saved into grades.
app.get('/admin/grades', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /admin/grades');
  }
  res.render('admin/grades', {
    page: 'admin/grades',
    currentUser: req.currentUser,
  });
});
/** Post grades. */
app.post('/admin/grades', loadUser, checkPermit('canAccessAdminPanel'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /admin/grades');
  }
});
/** Student dashboard. */
app.get('/dashboard', loadUser, loadLesson, checkPermit('canAccessDashboard'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /dashboard');
  }
  res.render('dashboard', {
    page: 'dashboard',
    currentUser: req.currentUser,
    currentLesson: req.currentLesson
  });
});
/** Viewing user profiles. */
app.get('/user/:username', loadUser, checkPermit('canReadUserInfoEveryone', sameUser('canReadUserInfo')), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /user/:username');
  }
  res.render('profile', {
    page: 'profile',
    currentUser: req.currentUser,
    grades: req.currentUser.canReadGradeEveryone(),
    viewing: req.currentUser.username
  });
});
/** Settings page. */
// TODO: Allow users to change their unit preferences, password, email, etc
// (maybe profile options if time).
app.get('/settings', loadUser, checkPermit('canWriteUserInfo'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /settings');
  }
  res.render('settings', {
    page: 'settings',
    currentUser: req.currentUser
  });
});
/** Collective lessons. */
app.get('/lessons', loadUser, checkPermit('canReadLesson'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /lessons');
  }
  Lesson.find({}, function(err, lessons) {
    if (DEBUG_ERR && err)
      console.log(err);
    res.render('lessons', {
      page: 'lessons',
      currentUser: req.currentUser,
      lessons: lessons
    });
  });
});
/** Webcast viewing. Defaults to currentUser.progress.
 *  Only displays progress control when the user has permission. */
app.get('/webcast', loadUser, loadLesson, checkPermit('canReadLesson'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /webcast');
  }
  res.render('video', {
    page: 'webcast',
    currentUser: req.currentUser,
    currentLesson: req.currentLesson,
    vids: req.currentLesson.videos,
    byurl: false,
    // TODO: implement controls so the user can mark a webcast as watched or not
    // watched.
    showControls: req.currentUser.canWriteProgress
  });
});
/** Viewing webcast at LESSONID.
 *  Only displays progress control when the user has permission. */
app.get('/webcast/:lessonId', loadUser, checkPermit('canReadLesson'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /webcast/:lessonId');
  }
  if (req.lesson) {
    res.render('video', {
      page: 'webcast',
      currentUser: req.currentUser,
      currentLesson: req.lesson,
      vids: req.lesson.videos,
      byurl: false,
      // TODO: implement progress controls
      showControls: req.currentUser.canWriteProgress
    });
  } else {
    req.flash('error', 'Whoops! Webcast for this lesson does not exist.');
    res.redirect('/lessons');
  }
});
/** Viewing webcast by its URL. */
app.get('/webcast/id/:videoId', loadUser, checkPermit('canReadLesson'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /webcast/id/:videoId');
  }
  res.render('video', {
    page: 'webcast',
    currentUser: req.currentUser,
    byurl: true,
    url: req.params.videoId,
    showControls: req.currentUser.canWriteProgress
  });
});
/** Homework. Defaults to currentUser.progress.
 *  Only displays progress control when the user has permission. */
app.get('/homework', loadUser, loadLesson, checkPermit('canReadLesson'), function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /homework');
  }
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
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /homework/:lessonId');
  }
  if (req.lesson) {
    res.render('homework', {
      page: 'homework',
      currentUser: req.currentUser,
      currentLesson: req.lesson,
      // TODO: implement progress controls
      showControls: req.currentUser.canWriteProgress
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
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /blog');
  }

});
/** Administration. */
// TODO: Compile administrative documents onto a static page.
// TODO: figure out permission for this static administration feature.
app.get('/administration', loadUser, function(req, res) {
  if (DEBUG_TRACE) {
    console.log('TRACE: GET /administration');
  }

});
/** Redirect everything else back to dashboard if logged in. */
app.get('*', function(req, res) {
  req.flash('error', "Whoops! The url you just went to does not exist.");
  res.redirect('/');
});
// TODO: Search function

/** Start server. */
var port = process.env.PORT || 8086;
app.listen(port);
