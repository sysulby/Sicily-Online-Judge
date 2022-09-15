let Course = syzoj.model('course');
let Contest = syzoj.model('contest');
let ContestPlayer = syzoj.model('contest_player');
let ContestRanklist = syzoj.model('contest_ranklist');
let Problem = syzoj.model('problem');
let User = syzoj.model('user');

app.get('/courses', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let allCourses = await Course.queryAll(Course.createQueryBuilder());

    let myCourses = await allCourses.filterAsync(async x => {
      if (!x.parent_id || !curUser) return false;
      if (await x.isSupervisior(curUser)) return true;
      return x.is_public && x.participants.split('|').includes(curUser.id.toString());
    });

    let activeIDs = (await myCourses.filterAsync(async x => !x.isEnded())).map(x => x.id);

    let query = Course.createQueryBuilder();
    if (activeIDs.length) {
      query.andWhere('id in (:ids)', { ids: activeIDs });
    } else {
      query.andWhere('false');
    }

    let paginate = syzoj.utils.paginate(
      await Course.countForPagination(query), req.query.page, syzoj.config.page.course);
    let activeCourses = await Course.queryPage(paginate, query, {
      start_time: 'DESC'
    });

    await activeCourses.forEachAsync(async x => {
      x.running = x.isRunning();
      x.ended = x.isEnded();
      x.teacher = await User.findById(x.owner_id);
    });

    let templateCourses = await allCourses.filterAsync(async x =>
      !x.parent_id && (x.is_public || await x.isSupervisior(curUser))
    );
    await templateCourses.forEachAsync(async x => {
      x.subtitle = await syzoj.utils.markdown(x.subtitle);
      x.teacher = await User.findById(x.owner_id);
    });

    res.render('courses', {
      has_any_course: myCourses.length > 0,
      active_courses: activeCourses,
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

app.get('/courses/archived', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let allCourses = await Course.queryAll(Course.createQueryBuilder());

    let myCourses = await allCourses.filterAsync(async x => {
      if (!x.parent_id || !curUser) return false;
      if (await x.isSupervisior(curUser)) return true;
      return x.is_public && x.participants.split('|').includes(curUser.id.toString());
    });

    let archivedIDs = (await myCourses.filterAsync(async x => x.isEnded())).map(x => x.id);

    let query = Course.createQueryBuilder();
    if (archivedIDs.length) {
      query.andWhere('id in (:ids)', { ids: archivedIDs });
    } else {
      query.andWhere('false');
    }

    let paginate = syzoj.utils.paginate(
      await Course.countForPagination(query), req.query.page, syzoj.config.page.course);
    let archivedCourses = await Course.queryPage(paginate, query, {
      start_time: 'DESC'
    });

    await archivedCourses.forEachAsync(async x => {
      x.teacher = await User.findById(x.owner_id);
    });

    res.render('courses_archived', {
      archived_courses: archivedCourses,
      paginate: paginate
    })
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

    const isSuperowner = await course.isSuperowner(curUser);
    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) {
      if (course.parent_id) {
        if (!curUser) throw new ErrorMessage('请先登录。',
          { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) })
        if (!course.participants.split('|').includes(curUser.id.toString())) {
          throw new ErrorMessage('您尚未选课。');
        }
      }
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
    }

    course.subtitle = await syzoj.utils.markdown(course.subtitle);
    course.information = await syzoj.utils.markdown(course.information);
    course.running = course.isRunning();
    course.ended = course.isEnded();

    let contestIDs = await course.getContests();
    let contests = await contestIDs.mapAsync(async id => await Contest.findById(id));

    res.render('course', {
      course: course,
      isSuperowner: isSuperowner,
      isSupervisior: isSupervisior,
      contests: contests
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
      if (!curUser || !curUser.is_admin) throw new ErrorMessage('您没有权限进行此操作。');
      course = await Course.create();
      course.id = 0;
    } else {
      // if course exists, both system administrators and course owner can edit it.
      if (!curUser || !(await course.isSuperowner(curUser) || curUser.id === course.owner_id)) {
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
      if (!curUser || !(await course.isSuperowner(curUser) || curUser.id === course.owner_id)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await course.loadRelationships();
    }

    if (!req.body.title.trim()) throw new ErrorMessage('课程名不能为空。');
    course.title = req.body.title;
    course.subtitle = req.body.subtitle;
    course.information = req.body.information;
    if (req.body.start_time) course.start_time = syzoj.utils.parseDate(req.body.start_time);
    if (req.body.end_time) course.end_time = syzoj.utils.parseDate(req.body.end_time);
    course.contests = '';
    course.participants = '';
    // only system administrators can set course owner
    if (curUser.is_admin) {
      course.owner_id = parseInt(req.body.owner);
    }
    if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
    course.admins = req.body.admins.join('|');
    course.is_public = (req.body.is_public === 'on');

    await course.save();

    res.redirect(syzoj.utils.makeUrl(['course', course.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/contest/:cid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) {
      if (course.parent_id) {
        if (!curUser) throw new ErrorMessage('请先登录。',
          { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) })
        if (!course.participants.split('|').includes(curUser.id.toString())) {
          throw new ErrorMessage('您尚未选课。');
        }
      }
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
    }

    let contestIDs = await course.getContests();

    let cid = parseInt(req.params.cid);
    if (cid < 1 || cid > contestIDs.length) throw new ErrorMessage('无此课节。');

    let contestID = contestIDs[cid - 1];
    let contest = await Contest.findById(contestID);
    await contest.loadRelationships();

    if (!contest.is_public && !isSupervisior) throw new ErrorMessage('课节未公开，请耐心等待 (´∀ `)');

    contest.subtitle = await syzoj.utils.markdown(contest.subtitle);
    contest.information = await syzoj.utils.markdown(contest.information);
    contest.running = contest.isRunning();
    contest.ended = contest.isEnded();

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
        } else if (contest.type === 'ioi') {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.findById(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
            await contest.loadRelationships();
            let multiplier = contest.ranklist.ranking_params[problem.problem.id] || 1.0;
            problem.feedback = (judge_state.score * multiplier).toString() + ' / ' + (100 * multiplier).toString();
          }
        } else if (contest.type === 'acm') {
          if (player.score_details[problem.problem.id]) {
            problem.status = {
              accepted: player.score_details[problem.problem.id].accepted,
              unacceptedCount: player.score_details[problem.problem.id].unacceptedCount
            };
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
          } else {
            problem.status = null;
          }
        }
      }
    }

    let hasStatistics = false;
    if ((!contest.hide_statistics) || (contest.ended) || (isSupervisior)) {
      hasStatistics = true;

      await contest.loadRelationships();
      let players = await contest.ranklist.getPlayers();
      for (let problem of problems) {
        problem.statistics = { attempt: 0, accepted: 0 };

        if (contest.type === 'ioi' || contest.type === 'noi') {
          problem.statistics.partially = 0;
        }

        for (let player of players) {
          if (player.score_details[problem.problem.id]) {
            problem.statistics.attempt++;
            if ((contest.type === 'acm' && player.score_details[problem.problem.id].accepted) || ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.problem.id].score === 100)) {
              problem.statistics.accepted++;
            }

            if ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.problem.id].score > 0) {
              problem.statistics.partially++;
            }
          }
        }
      }
    }

    res.render('course_contest', {
      contest: contest,
      problems: problems,
      hasStatistics: hasStatistics,
      isSupervisior: isSupervisior
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/contest/:cid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    if (!curUser || !(await course.isSuperowner(curUser) || curUser.id !== course.owner_id)) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }
    await course.loadRelationships();

    let contestIDs = await course.getContests();

    let cid = parseInt(req.params.cid);
    if (cid < 0 || cid > contestIDs.length) throw new ErrorMessage('无此课节。');

    let contestID = (cid > 0 ? contestIDs[cid - 1] : 0);
    let contest = await Contest.findById(contestID);

    if (!contest) {
      if (!await course.isSuperowner(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      contest = await Contest.create();
      contest.id = 0;
    } else {
      await contest.loadRelationships();
    }

    let problems = [];
    if (contest.problems) {
      problems = await contest.problems.split('|').mapAsync(async id => await Problem.findById(id));
    }

    res.render('course_contest_edit', {
      course: course,
      cid: cid,
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

app.post('/course/:id/contest/:cid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    if (!curUser || !(await course.isSuperowner(curUser) || curUser.id !== course.owner_id)) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }
    await course.loadRelationships();

    let contestIDs = await course.getContests();

    let cid = parseInt(req.params.cid);
    if (cid < 0 || cid > contestIDs.length) throw new ErrorMessage('无此课节。');

    let contestID = (cid > 0 ? contestIDs[cid - 1] : 0);
    let contest = await Contest.findById(contestID);

    if (!contest) {
      if (!await course.isSuperowner(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }

      contest = await Contest.create();
      ranklist = await ContestRanklist.create();

      if (!['noi', 'ioi', 'acm'].includes(req.body.type)) throw new ErrorMessage('无效的赛制。');
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
    if (req.body.start_time) contest.start_time = syzoj.utils.parseDate(req.body.start_time);
    if (req.body.end_time) contest.end_time = syzoj.utils.parseDate(req.body.end_time);
    if (!Array.isArray(req.body.problems)) req.body.problems = [req.body.problems];
    contest.problems = req.body.problems.join('|');
    contest.hide_statistics = (req.body.hide_statistics === 'on');
    contest.is_public = (req.body.is_public === 'on');

    await contest.save();

    if (!cid) {
      cid = contestIDs.length + 1;
      course.contests += (cid > 1 ? "|" : "") + contest.id;

      await course.save();
    }

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'contest', cid]));
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

app.get('/course/:id/records', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    if (course.parent_id) res.redirect(syzoj.utils.makeUrl(['course', course.parent_id, 'records']));

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    course.subtitle = await syzoj.utils.markdown(course.subtitle);

    let query = Course.createQueryBuilder();
    if (!course.parent_id) {
      query.andWhere('parent_id = :parent_id', { parent_id: course.id });
    } else {
      query.andWhere('false');
    }

    let paginate = syzoj.utils.paginate(
      await Course.countForPagination(query), req.query.page, syzoj.config.page.course);
    let records = await Course.queryPage(paginate, query, {
      start_time: 'DESC'
    });

    await records.forEachAsync(async x => {
      x.running = x.isRunning();
      x.ended = x.isEnded();
      x.teacher = await User.findById(x.owner_id);
    });

    res.render('course_records', {
      course: course,
      isSupervisior: isSupervisior,
      records: records,
      paginate: paginate
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/apply', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
