let Course = syzoj.model('course');
let Clazz = syzoj.model('clazz');
let Contest = syzoj.model('contest');
let ContestPlayer = syzoj.model('contest_player');
let ContestRanklist = syzoj.model('contest_ranklist');
let Problem = syzoj.model('problem');
let ProblemTag = syzoj.model('problem_tag');
let User = syzoj.model('user');
let Article = syzoj.model('article');

app.get('/courses', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let allCourses = await Course.queryAll(Course.createQueryBuilder());
    let courses = await allCourses.filterAsync(async x => x.is_public || await x.isSupervisior(curUser));

    await courses.forEachAsync(async x => {
      x.subtitle = await syzoj.utils.markdown(x.subtitle);
      x.owner = await User.findById(x.owner_id);
    });

    if (!curUser) {
      res.render('courses', {
        courses: courses
      });
      return;
    }

    await courses.forEachAsync(async x => {
      if (await x.hasOwnership(curUser)) {
        let query = Clazz.createQueryBuilder().andWhere('is_public = 0');
        query.andWhere('course_id = :course_id', { course_id: x.id });
        if (!curUser.is_admin) query.andWhere('teachers = \'\'');
        x.notice = await Clazz.countQuery(query);
      }
    });

    let publicClasses = await Clazz.queryAll(Clazz.createQueryBuilder().andWhere('is_public = 1'));
    let myClasses = await publicClasses.filterAsync(async x => await x.isParticipant(curUser));
    let myActiveClassIDs = myClasses.filter(x => !x.isEnded()).map(x => x.id);

    if (!myActiveClassIDs.length) {
      res.render('courses', {
        courses: courses,
        active_classes: []
      });
      return;
    }

    let query = Clazz.createQueryBuilder().andWhere('id in (:ids)', { ids: myActiveClassIDs });
    let paginate = syzoj.utils.paginate(
      await Clazz.countForPagination(query), req.query.page, syzoj.config.page.course);

    let activeClasses = await Clazz.queryPage(paginate, query, {
      start_time: 'DESC'
    });

    await activeClasses.forEachAsync(async x => {
      x.running = x.isRunning();
      x.teacher = await User.findById(await x.getMainTeacher());
    });

    res.render('courses', {
      courses: courses,
      active_classes: activeClasses,
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

    if (!curUser) throw new ErrorMessage('请先登录。',
      { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

    let publicClasses = await Clazz.queryAll(Clazz.createQueryBuilder().andWhere('is_public = 1'));
    let myClasses = await publicClasses.filterAsync(async x => await x.isParticipant(curUser));
    let myArchivedClassIDs = myClasses.filter(x => x.isEnded()).map(x => x.id);

    if (!myArchivedClassIDs.length) {
      res.render('courses_archived', {
        archived_classes: []
      });
      return;
    }

    let query = Clazz.createQueryBuilder().andWhere('id in (:ids)', { ids: myArchivedClassIDs });
    let paginate = syzoj.utils.paginate(
      await Clazz.countForPagination(query), req.query.page, syzoj.config.page.course);

    let archivedClasses = await Clazz.queryPage(paginate, query, {
      start_time: 'DESC'
    });

    await archivedClasses.forEachAsync(async x => {
      x.teacher = await User.findById(await x.getMainTeacher());
    });

    res.render('courses_archived', {
      archived_classes: archivedClasses,
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

    const isCourseOwner = await course.hasOwnership(curUser);
    const isSupervisior = await course.isSupervisior(curUser);
    const allowedManageClass = (curUser && await curUser.hasPrivilege('manage_class'));

    if (!course.is_public && !isSupervisior) throw new ErrorMessage('课程主页维护中，请稍后再试。');

    course.subtitle = await syzoj.utils.markdown(course.subtitle);
    course.information = await syzoj.utils.markdown(course.information);

    let lessonIDs = await course.getLessons();
    let lessons = await lessonIDs.mapAsync(async id => await Contest.findById(id));

    res.render('course', {
      course: course,
      isCourseOwner: isCourseOwner,
      isSupervisior: isSupervisior,
      allowedManageClass: allowedManageClass,
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
    let teachers = [];
    if (course.teachers) {
      teachers = await course.teachers.split('|').mapAsync(async id => await User.findById(id));
    }

    res.render('course_edit', {
      course: course,
      owner: owner,
      teachers: teachers
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
    // only system administrators can set course owner and teachers and set public
    if (curUser.is_admin) {
      course.owner_id = parseInt(req.body.owner);
      if (!Array.isArray(req.body.teachers)) req.body.teachers = [req.body.teachers];
      course.teachers = req.body.teachers.join('|');
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

app.post('/course/:id/delete', async (req, res) => {
  try {
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
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate', 'publicize_time'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Problem.createQueryBuilder().where('course_id = :course_id', { course_id: course.id });

    if (sort === 'ac_rate') {
      query.orderBy('ac_num / submit_num', order.toUpperCase());
    } else {
      query.orderBy(sort, order.toUpperCase());
    }

    let paginate = syzoj.utils.paginate(await Problem.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.queryPage(paginate, query);

    await problems.forEachAsync(async problem => {
      problem.judge_state = await problem.getJudgeState(curUser, true);
      problem.tags = await problem.getTags();
    });

    res.render('course_problems', {
      course: course,
      problems: problems,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/problems/search', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let id = parseInt(req.query.keyword) || 0;
    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    syzoj.log(course.id);

    let query = Problem.createQueryBuilder().where('course_id = :course_id', { course_id: course.id });
    query.andWhere(new TypeORM.Brackets(qb => {
      qb.where('title LIKE :title', { title: `%${req.query.keyword}%` })
        .orWhere('id = :id', { id: id })
    }));

    query.orderBy('id = ' + id.toString(), 'DESC');
    if (sort === 'ac_rate') {
      query.addOrderBy('ac_num / submit_num', order.toUpperCase());
    } else {
      query.addOrderBy(sort, order.toUpperCase());
    }

    let paginate = syzoj.utils.paginate(await Problem.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.queryPage(paginate, query);

    await problems.forEachAsync(async problem => {
      problem.judge_state = await problem.getJudgeState(curUser, true);
      problem.tags = await problem.getTags();
    });

    res.render('course_problems', {
      course: course,
      problems: problems,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/problems/tag/:tagIDs', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let tagIDs = Array.from(new Set(req.params.tagIDs.split(',').map(x => parseInt(x))));
    let tags = await tagIDs.mapAsync(async tagID => ProblemTag.findById(tagID));
    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    let sortVal;
    if (sort === 'ac_rate') {
      sortVal = '`problem`.`ac_num` / `problem`.`submit_num`';
    } else {
      sortVal = '`problem`.`' + sort + '`';
    }

    // Validate the tagIDs
    for (let tag of tags) {
      if (!tag) {
        return res.redirect(syzoj.utils.makeUrl(['problems']));
      }
    }

    let sql = 'SELECT `id` FROM `problem` WHERE\n`problem`.`course_id` = ' + course.id;
    for (let tagID of tagIDs) {
      sql += ' AND\n`problem`.`id` IN (SELECT `problem_id` FROM `problem_tag_map` WHERE `tag_id` = ' + tagID + ')';
    }

    let paginate = syzoj.utils.paginate(await Problem.countQuery(sql), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.query(sql + ` ORDER BY ${sortVal} ${order} ` + paginate.toSQL());

    problems = await problems.mapAsync(async problem => {
      // query() returns plain objects.
      problem = await Problem.findById(problem.id);

      problem.judge_state = await problem.getJudgeState(curUser, true);
      problem.tags = await problem.getTags();

      return problem;
    });

    res.render('course_problems', {
      course: course,
      problems: problems,
      tags: tags,
      paginate: paginate,
      curSort: sort,
      curOrder: order === 'asc'
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/problem/:pid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let problemId = parseInt(req.params.pid);
    let problem = await Problem.findById(problemId);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');

    problem.allowedEdit = (isCourseOwner || curUser.id === problem.user_id);
    problem.allowedManage = isCourseOwner;

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let state = await problem.getJudgeState(res.locals.user, false);

    problem.tags = await problem.getTags();
    await problem.loadRelationships();

    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    let discussionCount = await Article.count({ problem_id: problem.id });

    res.render('course_problem', {
      course: course,
      problem: problem,
      state: state,
      lastLanguage: res.locals.user ? await res.locals.user.getLastSubmitLanguage() : null,
      testcases: testcases,
      discussionCount: discussionCount
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/problem/:pid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let problemID = parseInt(req.params.pid) || 0;
    let problem = await Problem.findById(problemID);

    if (!problem) {
      problem = await Problem.create({
        time_limit: syzoj.config.default.problem.time_limit,
        memory_limit: syzoj.config.default.problem.memory_limit,
        type: 'traditional'
      });
      problem.id = problemID;
      problem.allowedEdit = true;
      problem.tags = [];
      problem.new = true;
    } else {
      if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');
      problem.allowedEdit = (isCourseOwner || curUser.id === problem.user_id);
      if (!problem.allowedEdit) throw new ErrorMessage('您没有权限进行此操作。');
      problem.tags = await problem.getTags();
    }

    problem.allowedManage = isCourseOwner;

    res.render('course_problem_edit', {
      problem: problem
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/problem/:pid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let problemID = parseInt(req.params.pid) || 0;
    let problem = await Problem.findById(problemID);

    if (!problem) {
      problem = await Problem.create({
        time_limit: syzoj.config.default.problem.time_limit,
        memory_limit: syzoj.config.default.problem.memory_limit,
        type: 'traditional'
      });

      if (isCourseOwner) {
        let customID = parseInt(req.body.pid);
        if (customID) {
          if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
          problem.id = customID;
        } else if (problemID) problem.id = problemID;
      }

      problem.course_id = course.id;
      problem.user_id = res.locals.user.id;
      problem.publicizer_id = res.locals.user.id;
    } else {
      if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');
      if (!isCourseOwner && curUser.id !== problem.user_id) throw new ErrorMessage('您没有权限进行此操作。');

      if (isCourseOwner) {
        let customID = parseInt(req.body.pid);
        if (customID && customID !== problemID) {
          if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
          await problem.changeID(customID);
        }
      }
    }

    if (!req.body.title.trim()) throw new ErrorMessage('题目名不能为空。');
    problem.title = req.body.title;
    problem.description = req.body.description;
    problem.input_format = req.body.input_format;
    problem.output_format = req.body.output_format;
    problem.example = req.body.example;
    problem.limit_and_hint = req.body.limit_and_hint;
    problem.is_anonymous = (req.body.is_anonymous === 'on');

    // Save the problem first, to have the `id` allocated
    await problem.save();

    if (!req.body.tags) {
      req.body.tags = [];
    } else if (!Array.isArray(req.body.tags)) {
      req.body.tags = [req.body.tags];
    }

    let newTagIDs = await req.body.tags.map(x => parseInt(x)).filterAsync(async x => ProblemTag.findById(x));
    await problem.setTags(newTagIDs);

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'problem', problem.id]));
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
    let ranklist = null;

    if (!contest) {
      contest = await Contest.create();
      ranklist = await ContestRanklist.create();

      contest.holder_id = curUser.id;
      contest.teachers = '';
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
    if (!['ioi', 'noi'].includes(req.body.type)) throw new ErrorMessage('无效的赛制。');
    contest.type = req.body.type;
    contest.hide_statistics = (contest.type === 'noi');
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

app.post('/course/:id/lesson/:lid/move_up', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/lesson/:lid/move_down', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/lesson/:lid/delete', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/classes', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const isSupervisior = await course.isSupervisior(curUser);

    // [TODO]: should course teachers can watch all related classes???
    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    course.subtitle = await syzoj.utils.markdown(course.subtitle);

    let query = Clazz.createQueryBuilder();
    query.andWhere('course_id = :course_id', { course_id: courseID });

    let paginate = syzoj.utils.paginate(
      await Clazz.countForPagination(query), req.query.page, syzoj.config.page.course);
    // [TODO]: none teacher class first if un-public?
    let classes = await Clazz.queryPage(paginate, query, {
      is_public: 'ASC',
      start_time: 'DESC'
    });

    await classes.forEachAsync(async x => {
      x.running = x.isRunning();
      x.ended = x.isEnded();
      x.teacher = await User.findById(await x.getMainTeacher());
    });

    res.render('course_classes', {
      course: course,
      isCourseOwner: isCourseOwner,
      isSupervisior: isSupervisior,
      classes: classes,
      paginate: paginate
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/class/:cid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let classID = parseInt(req.params.cid);
    let clazz = await Clazz.findById(classID);

    if (!clazz) throw new ErrorMessage('无此班级。');
    if (clazz.course_id !== course.id) throw new ErrorMessage('错误的课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!clazz.is_public) throw new ErrorMessage('课程主页维护中，请稍后再试。');
      if (!curUser) throw new ErrorMessage('请先登录。',
        { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });
      // [TODO]: clazz register
      if (!clazz.students.split('|').includes(curUser.id.toString())) {
        throw new ErrorMessage('您尚未选课。');
      }
    }

    clazz.information = await syzoj.utils.markdown(clazz.information);
    clazz.running = clazz.isRunning();
    clazz.ended = clazz.isEnded();

    let lessonIDs = await clazz.getLessons();
    let lessons = await lessonIDs.mapAsync(async id => await Contest.findById(id));

    res.render('course_class', {
      course: course,
      clazz: clazz,
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

app.get('/course/:id/class/:cid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let classID = parseInt(req.params.cid);
    let clazz = await Clazz.findById(classID);

    if (!clazz) {
      // if clazz does not exist, only course supervisior can create one
      if (!curUser || !await course.isSupervisior(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      clazz = await Clazz.create();
      clazz.id = 0;
    } else {
      if (clazz.course_id !== course.id) throw new ErrorMessage('错误的课程。');
      // if clazz exists, both system administrators and clazz owner can edit it.
      if (!curUser || !await clazz.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await clazz.loadRelationships();
    }

    let owner = curUser;
    if (clazz.owner_id) owner = await User.findById(clazz.owner_id);
    let teachers = [];
    if (clazz.teachers) {
      teachers = await clazz.teachers.split('|').mapAsync(async id => await User.findById(id));
    }

    res.render('course_class_edit', {
      course: course,
      clazz: clazz,
      owner: owner,
      teachers: teachers
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/class/:cid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let classID = parseInt(req.params.cid);
    let clazz = await Clazz.findById(classID);

    if (!clazz) {
      // if clazz does not exist, only course supervisior can create one
      if (!curUser || !await course.isSupervisior(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      clazz = await Clazz.create();
      clazz.course_id = course.id;
      clazz.lessons = '';
      clazz.students = '';
      clazz.owner_id = parseInt(req.body.owner);
      clazz.teachers = '';
      clazz.is_public = 0;
    } else {
      if (clazz.course_id !== course.id) throw new ErrorMessage('错误的课程。');
      // if clazz exists, both system administrators and clazz owner can edit it.
      if (!curUser || !await clazz.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await clazz.loadRelationships();
    }

    if (!req.body.title.trim()) throw new ErrorMessage('班级名不能为空。');
    clazz.title = req.body.title;
    clazz.information = req.body.information;
    clazz.start_time = syzoj.utils.parseDate(req.body.start_time);
    clazz.end_time = syzoj.utils.parseDate(req.body.end_time);
    // [TODO]: who can set clazz owner???
    if (curUser.is_admin) {
      clazz.owner_id = parseInt(req.body.owner);
    }
    if (await course.hasOwnership(curUser)) {
      if (!Array.isArray(req.body.teachers)) req.body.teachers = [req.body.teachers];
      clazz.teachers = req.body.teachers.join('|');
    }
    if (curUser.is_admin) {
      clazz.is_public = (req.body.is_public === 'on');
    }

    await clazz.save();

    res.redirect(syzoj.utils.makeUrl(['course', clazz.course_id, 'class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/class/:cid/approval', async (req, res) => {
  try {
    // [TODO]: auto create lessons when approved
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/class/:cid/delete', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/class/:cid/lesson/:lid', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/class/:cid/lesson/:lid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let classID = parseInt(req.params.cid);
    let clazz = await Clazz.findById(classID);

    if (!clazz) throw new ErrorMessage('无此班级。');
    if (clazz.course_id !== course.id) throw new ErrorMessage('错误的课程。');

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

app.post('/course/:id/class/:cid/lesson/:lid/edit', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/class/:cid/lesson/:lid/move_up', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/class/:cid/lesson/:lid/move_down', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/class/:cid/lesson/:lid/delete', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
