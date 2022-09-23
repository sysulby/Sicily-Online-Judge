let Course = syzoj.model('course');
let Batch = syzoj.model('batch');
let Contest = syzoj.model('contest');
let ContestPlayer = syzoj.model('contest_player');
let ContestRanklist = syzoj.model('contest_ranklist');
let Problem = syzoj.model('problem');
let User = syzoj.model('user');

app.get('/courses', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let allCourses = await Course.queryAll(Course.createQueryBuilder());

    let courses = await allCourses.filterAsync(async x => {
      return x.is_public || await x.isSupervisior(curUser);
    });

    await courses.forEachAsync(async x => {
      x.subtitle = await syzoj.utils.markdown(x.subtitle);
      x.owner = await User.findById(x.owner_id);
    });

    if (!curUser) {
      res.render('courses', {
        courses: courses,
        has_batch: false
      });
      return;
    }

    let allBatches = await Batch.queryAll(Batch.createQueryBuilder());

    // [TODO]: divide my batch into batches as teacher or batches as admin
    let myBatches = await allBatches.filterAsync(async x => {
      if (await x.isSupervisior(curUser)) return true;
      return x.is_public && x.participants.split('|').includes(curUser.id.toString());
    });

    if (!myBatches.length) {
      res.render('courses', {
        courses: courses,
        has_batch: false
      });
      return;
    }

    let activeIDs = (await myBatches.filterAsync(async x => !x.isEnded())).map(x => x.id);

    if (!activeIDs.length) {
      res.render('courses', {
        courses: courses,
        has_batch: true,
        active_batches: []
      });
      return;
    }

    let query = Batch.createQueryBuilder();
    query.andWhere('id in (:ids)', { ids: activeIDs });

    let paginate = syzoj.utils.paginate(
      await Batch.countForPagination(query), req.query.page, syzoj.config.page.course);

    let activeBatches = await Batch.queryPage(paginate, query, {
      is_public: 'ASC',
      start_time: 'DESC'
    });

    await activeBatches.forEachAsync(async x => {
      x.running = x.isRunning();
      x.teacher = await User.findById(await x.getTeacher());
    });

    res.render('courses', {
      courses: courses,
      has_batch: true,
      active_batches: activeBatches,
      paginate: paginate
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/courses/archived', async (req, res) => {
  try {
    const curUser = res.locals.user;

    if (!curUser) {
      res.render('courses_archived', {
        archived_batches: []
      });
      return;
    }

    let allBatches = await Batch.queryAll(Batch.createQueryBuilder());

    let myBatches = await allBatches.filterAsync(async x => {
      if (await x.isSupervisior(curUser)) return true;
      return x.is_public && x.participants.split('|').includes(curUser.id.toString());
    });

    let archivedIDs = (await myBatches.filterAsync(async x => x.isEnded())).map(x => x.id);

    if (!archivedIDs.length) {
      res.render('courses_archived', {
        archived_batches: []
      });
      return;
    }

    let query = Batch.createQueryBuilder();
    query.andWhere('id in (:ids)', { ids: archivedIDs });

    let paginate = syzoj.utils.paginate(
      await Batch.countForPagination(query), req.query.page, syzoj.config.page.course);

    let archivedBatches = await Batch.queryPage(paginate, query, {
      is_public: 'ASC',
      start_time: 'DESC'
    });

    await archivedBatches.forEachAsync(async x => {
      x.teacher = await User.findById(await x.getTeacher());
    });

    res.render('courses_archived', {
      archived_batches: archivedBatches,
      paginate: paginate
    });
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

    const hasOwnership = await course.hasOwnership(curUser);
    const isSupervisior = await course.isSupervisior(curUser);

    if (!course.is_public && !isSupervisior) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');

    course.subtitle = await syzoj.utils.markdown(course.subtitle);
    course.information = await syzoj.utils.markdown(course.information);

    let lessonIDs = await course.getLessons();
    let lessons = await lessonIDs.mapAsync(async id => await Contest.findById(id));

    res.render('course', {
      course: course,
      hasOwnership: hasOwnership,
      isSupervisior: isSupervisior,
      lessons: lessons
    });
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
      if (!curUser || !curUser.is_admin) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      course = await Course.create();
      course.id = 0;
    } else {
      // if course exists, both system administrators and course owner can edit it.
      if (!curUser || !await course.hasOwnership(curUser)) {
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
      if (!curUser || !curUser.is_admin) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      course = await Course.create();
      course.lessons = '';
    } else {
      // if course exists, both system administrators and course owner can edit it.
      if (!curUser || !await course.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await course.loadRelationships();
    }

    if (!req.body.title.trim()) throw new ErrorMessage('课程名不能为空。');
    course.title = req.body.title;
    course.subtitle = req.body.subtitle;
    course.information = req.body.information;
    // only system administrators can set course owner and admins and set public
    if (curUser.is_admin) {
      course.owner_id = parseInt(req.body.owner);
      if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
      course.admins = req.body.admins.join('|');
      course.is_public = (req.body.is_public === 'on');
    }

    await course.save();

    res.redirect(syzoj.utils.makeUrl(['course', course.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/lesson/:lid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let lessonIDs = await course.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let contestID = lessonIDs[lid - 1];
    let contest = await Contest.findById(contestID);
    await contest.loadRelationships();

    contest.subtitle = await syzoj.utils.markdown(contest.subtitle);
    contest.information = await syzoj.utils.markdown(contest.information);

    let problemIDs = await contest.getProblems();
    let problems = await problemIDs.mapAsync(async id => await Problem.findById(id));

    let player = null;

    if (curUser) {
      player = await ContestPlayer.findInContest({
        contest_id: contest.id,
        user_id: curUser.id
      });
    }

    problems = problems.map(x => ({ problem: x, status: null, judge_id: null, statistics: null }));
    if (player) {
      for (let problem of problems) {
        if (contest.type === 'noi') {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.findById(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            if (!contest.ended && !await problem.problem.isAllowedEditBy(res.locals.user) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
              problem.status = 'Submitted';
            }
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
          }
        } else {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.findById(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
            await contest.loadRelationships();
            let multiplier = contest.ranklist.ranking_params[problem.problem.id] || 1.0;
            problem.feedback = (judge_state.score * multiplier).toString() + ' / ' + (100 * multiplier).toString();
          }
        }
      }
    }

    let hasStatistics = false;
    if (contest.type === 'ioi' || contest.ended) {
      hasStatistics = true;

      await contest.loadRelationships();
      let players = await contest.ranklist.getPlayers();
      for (let problem of problems) {
        problem.statistics = { attempt: 0, accepted: 0 };
        problem.statistics.partially = 0;
        for (let player of players) {
          if (player.score_details[problem.problem.id]) {
            problem.statistics.attempt++;
            if (player.score_details[problem.problem.id].score === 100) {
              problem.statistics.accepted++;
            }
            if (player.score_details[problem.problem.id].score > 0) {
              problem.statistics.partially++;
            }
          }
        }
      }
    }

    res.render('course_lesson', {
      contest: contest,
      problems: problems,
      hasStatistics: hasStatistics,
      // [TODO]: isSupervisior always true???
      isSupervisior: isSupervisior
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/lesson/:lid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    // both system administrators and course owner can edit it.
    if (!curUser || !await course.hasOwnership(curUser)) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let lessonIDs = await course.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 0 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let contestID = (lid > 0 ? lessonIDs[lid - 1] : 0);
    let contest = await Contest.findById(contestID);

    if (!contest) {
      contest = await Contest.create();
      contest.id = 0;
    } else {
      await contest.loadRelationships();
    }

    let problems = [];
    if (contest.problems) {
      problems = await contest.problems.split('|').mapAsync(async id => await Problem.findById(id));
    }

    res.render('course_lesson_edit', {
      course: course,
      lid: lid,
      contest: contest,
      problems: problems
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/lesson/:lid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    // both system administrators and course owner can edit it.
    if (!curUser || !await course.hasOwnership(curUser)) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let lessonIDs = await course.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 0 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let contestID = (lid > 0 ? lessonIDs[lid - 1] : 0);
    let contest = await Contest.findById(contestID);

    if (!contest) {
      contest = await Contest.create();
      ranklist = await ContestRanklist.create();

      if (!['ioi', 'noi'].includes(req.body.type)) throw new ErrorMessage('无效的赛制。');
      contest.type = req.body.type;
    } else {
      await contest.loadRelationships();
      ranklist = contest.ranklist;
    }

    try {
      ranklist.ranking_params = JSON.parse(req.body.ranking_params);
    } catch (e) {
      ranklist.ranking_params = {};
    }
    await ranklist.save();
    contest.ranklist_id = ranklist.id;

    if (!req.body.title.trim()) throw new ErrorMessage('课节名不能为空。');
    contest.title = req.body.title;
    contest.subtitle = req.body.subtitle;
    contest.information = req.body.information;
    if (!Array.isArray(req.body.problems)) req.body.problems = [req.body.problems];
    contest.problems = req.body.problems.join('|');
    // [TODO]: update logic about is_public
    contest.is_public = (req.body.is_public === 'on');

    await contest.save();

    if (!lid) {
      lid = lessonIDs.length + 1;
      course.lessons += (lid > 1 ? "|" : "") + contest.id;

      await course.save();
    }

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'lesson', lid]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/batches', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    // [TODO]: should course admins can watch all related batches???
    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    course.subtitle = await syzoj.utils.markdown(course.subtitle);

    let query = Batch.createQueryBuilder();
    query.andWhere('course_id = :course_id', { course_id: courseID });

    let paginate = syzoj.utils.paginate(
      await Batch.countForPagination(query), req.query.page, syzoj.config.page.course);
    let batches = await Batch.queryPage(paginate, query, {
      is_public: 'ASC',
      start_time: 'DESC'
    });

    await batches.forEachAsync(async x => {
      x.running = x.isRunning();
      x.ended = x.isEnded();
      x.teacher = await User.findById(await x.getTeacher());
    });

    res.render('course_batches', {
      course: course,
      isSupervisior: isSupervisior,
      batches: batches,
      paginate: paginate
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/batch/:bid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let batchID = parseInt(req.params.bid);
    let batch = await Batch.findById(batchID);

    if (!batch) throw new ErrorMessage('无此课程。');
    if (batch.course_id !== course.id) throw new ErrorMessage('错误的课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const isSupervisior = await batch.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!batch.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
      if (!curUser) throw new ErrorMessage('请先登录。',
        { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });
      // [TODO]: batch register
      if (!batch.participants.split('|').includes(curUser.id.toString())) {
        throw new ErrorMessage('您尚未选课。');
      }
    }

    batch.information = await syzoj.utils.markdown(batch.information);
    batch.running = batch.isRunning();
    batch.ended = batch.isEnded();

    let lessonIDs = await batch.getLessons();
    let lessons = await lessonIDs.mapAsync(async id => await Contest.findById(id));

    res.render('course_batch', {
      course: course,
      batch: batch,
      isCourseOwner: isCourseOwner,
      isSupervisior: isSupervisior,
      lessons: lessons
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/batch/:bid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let batchID = parseInt(req.params.bid);
    let batch = await Batch.findById(batchID);

    if (!batch) {
      // if batch does not exist, only course supervisior can create one
      if (!curUser || !await course.isSupervisior(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      batch = await Batch.create();
      batch.id = 0;
    } else {
      if (batch.course_id !== course.id) throw new ErrorMessage('错误的课程。');
      // if batch exists, both system administrators and batch owner can edit it.
      if (!curUser || !await batch.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await batch.loadRelationships();
    }

    let owner = curUser;
    if (batch.owner_id) owner = await User.findById(batch.owner_id);
    let admins = [];
    if (batch.admins) {
      admins = await batch.admins.split('|').mapAsync(async id => await User.findById(id));
    }

    res.render('course_batch_edit', {
      course: course,
      batch: batch,
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

app.post('/course/:id/batch/:bid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let batchID = parseInt(req.params.bid);
    let batch = await Batch.findById(batchID);

    if (!batch) {
      // if batch does not exist, only course supervisior can create one
      if (!curUser || !await course.isSupervisior(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      batch = await Batch.create();
      batch.course_id = course.id;
      // [TODO]: auto create lessons
      batch.lessons = '';
      batch.participants = '';
      batch.owner_id = parseInt(req.body.owner);
      batch.admins = '';
      batch.is_public = 0;
    } else {
      if (batch.course_id !== course.id) throw new ErrorMessage('错误的课程。');
      // if batch exists, both system administrators and batch owner can edit it.
      if (!curUser || !await batch.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await batch.loadRelationships();
    }

    if (!req.body.title.trim()) throw new ErrorMessage('班级名不能为空。');
    batch.title = req.body.title;
    batch.information = req.body.information;
    batch.start_time = syzoj.utils.parseDate(req.body.start_time);
    batch.end_time = syzoj.utils.parseDate(req.body.end_time);
    // [TODO]: who can set batch owner???
    if (curUser.is_admin) {
      batch.owner_id = parseInt(req.body.owner);
    }
    if (await course.hasOwnership(curUser)) {
      if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
      batch.admins = req.body.admins.join('|');
    }
    if (curUser.is_admin) {
      batch.is_public = (req.body.is_public === 'on');
    }

    await batch.save();

    res.redirect(syzoj.utils.makeUrl(['course', batch.course_id, 'batch', batch.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/batch/:bid/lesson/:lid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let batchID = parseInt(req.params.bid);
    let batch = await Batch.findById(batchID);

    if (!batch) throw new ErrorMessage('无此课程。');
    if (batch.course_id !== course.id) throw new ErrorMessage('错误的课程。');

    // both system administrators and course owner can edit it.
    if (!curUser || !await course.hasOwnership(curUser)) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/problems', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
