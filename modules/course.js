let Course = syzoj.model('course');
let Contest = syzoj.model('contest');
let User = syzoj.model('user');

app.get('/courses', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let allCourses = await Course.queryAll(Course.createQueryBuilder());

    let templateIDs = (await allCourses.filterAsync(async x =>
      !x.parent_id && (x.is_public || await x.isSupervisior(curUser))
    )).map(x => x.id);

    let query = Course.createQueryBuilder();
    if (templateIDs.length) {
      query.andWhere('id in (:ids)', { ids: templateIDs });
    } else {
      query.andWhere('false');
    }

    let paginate = syzoj.utils.paginate(
      await Course.countForPagination(query), req.query.page, syzoj.config.page.course);
    let templateCourses = await Course.queryPage(paginate, query);

    await templateCourses.forEachAsync(async x => {
      x.subtitle = await syzoj.utils.markdown(x.subtitle);
      x.teacher = await User.findById(x.owner_id);
    });

    res.render('courses', {
      template_courses: templateCourses,
      paginate: paginate
    })
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) {
      // if course does not exist, only system administrators can create one
      if (!curUser || !curUser.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
      course = await Course.create();
      course.id = 0;
    } else {
      // if course exists, both system administrators and course owner can edit it.
      if (!curUser || !(curUser.is_admin || curUser.id === course.owner_id)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await course.loadRelationships();
    }

    let owner = curUser;
    if (course.owner_id) owner = await User.findById(course.owner_id);
    let admins = [];
    if (course.admins) {
      admins = await course.admins.split('|').mapAsync(async id => await User.findById(id));
    }

    res.render('course_edit', {
      course: course,
      owner: owner,
      admins: admins
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) {
      // if course does not exist, only system administrators can create one
      if (!curUser || !curUser.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
      course = await Course.create();
    } else {
      // if course exists, both system administrators and course owner can edit it.
      if (!curUser || !(curUser.is_admin || curUser.id === course.owner_id)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await course.loadRelationships();
    }

    if (!req.body.title.trim()) throw new ErrorMessage('课程名不能为空。');
    course.title = req.body.title;
    course.subtitle = req.body.subtitle;
    course.information = req.body.information;
    course.contests = '';
    course.participants = '';
    // only system administrators can set course owner
    if (curUser.is_admin) {
      course.owner_id = parseInt(req.body.owner);
    }
    if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
    course.admins = req.body.admins.join('|');
    course.is_public = req.body.is_public === 'on';

    await course.save();

    res.redirect(syzoj.utils.makeUrl(['course', course.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);
    // if course is non-public, both system administrators and course administrators can see it.
    if (!course.is_public && !isSupervisior) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');

    course.subtitle = await syzoj.utils.markdown(course.subtitle);
    course.information = await syzoj.utils.markdown(course.information);
    course.running = course.isRunning();
    course.ended = course.isEnded();

    let contestIDs = await course.getContests();
    let contests = await contestIDs.mapAsync(async id => await Contest.findById(id));

    res.render('course', {
      course: course,
      contests: contests,
      isSupervisior: isSupervisior
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/ranklist', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，敬请期待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
