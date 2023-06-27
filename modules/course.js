let Course = syzoj.model('course');
let Contest = syzoj.model('contest');
let Problem = syzoj.model('problem');
let ProblemSet = syzoj.model('problem_set');
let ProblemTag = syzoj.model('problem_tag');
let JudgeState = syzoj.model('judge_state');
let Article = syzoj.model('article');
let User = syzoj.model('user');

const { getSubmissionInfo, getRoughResult, processOverallResult } = require('../libs/submissions_process');

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

    res.render('courses', {
      courses: courses
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

    if (!course.is_public && !isSupervisior) throw new ErrorMessage('课程主页维护中，请稍后再试。');

    course.subtitle = await syzoj.utils.markdown(course.subtitle);
    course.information = await syzoj.utils.markdown(course.information);

    let lessonIDs = await course.getLessons();
    let lessons = await lessonIDs.mapAsync(async id => await Contest.findById(id));
    if (!isSupervisior) lessons = lessons.filter(x => x.is_public);

    res.render('course', {
      course: course,
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
    let problem_sets = [];
    if (course.problem_sets) {
      problem_sets = await course.problem_sets.split('|').mapAsync(async id => await ProblemSet.findById(id));
    }

    res.render('course_edit', {
      course: course,
      owner: owner,
      teachers: teachers,
      problem_sets: problem_sets
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
    if (!Array.isArray(req.body.problem_sets)) req.body.problem_sets = [req.body.problem_sets];
    course.problem_sets = req.body.problem_sets.join('|');
    // [TODO]: clear lesson problems if problem_sets is changed.

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

    let problemSetIDs = course.problem_sets.split('|');
    let problemSets = await problemSetIDs.mapAsync(async setID => await ProblemSet.findById(setID));

    let problemSet;
    if (req.query.set && problemSetIDs.includes(req.query.set)) {
      problemSet = await ProblemSet.findById(req.query.set);
    }

    const sort = req.query.sort || syzoj.config.sorting.problem.field;
    const order = req.query.order || syzoj.config.sorting.problem.order;
    if (!['id', 'title', 'rating', 'ac_num', 'submit_num', 'ac_rate', 'publicize_time'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }

    let query = Problem.createQueryBuilder();
    if (problemSet) {
      query.where('id IN (SELECT `problem_id` FROM `problem_set_map` WHERE `set_id` = :setID)', { setID: problemSet.id });
    } else {
      query.where('id IN (SELECT `problem_id` FROM `problem_set_map` WHERE `set_id` IN (:setIDs))', { setIDs: problemSetIDs });
    }

    let id = 0;
    if (req.query.keyword) {
      id = parseInt(req.query.keyword) || 0;
      query.andWhere(new TypeORM.Brackets(qb => {
             qb.where('title LIKE :title', { title: `%${req.query.keyword}%` })
               .orWhere('id = :id', { id: id })
           }));
    }

    query.orderBy('id = ' + id.toString(), 'DESC');
    if (sort === 'ac_rate') {
      query.addOrderBy('ac_num / submit_num', order.toUpperCase());
    } else {
      query.addOrderBy(sort, order.toUpperCase());
    }

    let tags;
    if (req.query.tags) {
      let tagIDs = Array.from(new Set(req.query.tags.split(',').map(x => parseInt(x))));
      tags = (await tagIDs.mapAsync(async tagID => ProblemTag.findById(tagID))).filter(tag => tag != null);
      query.andWhere('id IN (SELECT `problem_id` FROM `problem_tag_map` WHERE tag_id IN (:tagIDs) GROUP BY problem_id HAVING COUNT(DISTINCT tag_id) = :num)', { tagIDs: tags.map(tag => tag.id), num: tags.length });
    }

    let paginate = syzoj.utils.paginate(await Problem.countForPagination(query), req.query.page, syzoj.config.page.problem);
    let problems = await Problem.queryPage(paginate, query);

    await problems.forEachAsync(async problem => {
      problem.judge_state = await problem.getJudgeState(curUser, true, 2, course.id);
      problem.tags = await problem.getTags();
    });

    res.render('course_problems', {
      course: course,
      problemSet: problemSet,
      problemSets: problemSets,
      keyword: req.query.keyword,
      tags: tags,
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

app.get('/course/:id/problem/:pid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let problemID = parseInt(req.params.pid);
    let problem = await Problem.findById(problemID);

    if (!problem || !await course.hasProblem(problem)) throw new ErrorMessage('无此题目。');

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let state = await problem.getJudgeState(curUser, false, 2, course.id);

    problem.tags = await problem.getTags();
    await problem.loadRelationships();

    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    let discussionCount = await Article.count({ problem_id: problem.id });

    res.render('course_problem', {
      course: course,
      problem: problem,
      state: state,
      lastLanguage: await curUser.getLastSubmitLanguage(),
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

const displayConfig = {
  showScore: true,
  showUsage: true,
  showCode: true,
  showResult: true,
  showOthers: true,
  showTestdata: false,
  showDetailResult: true,
  inContest: false,
  showRejudge: false
};

app.get('/submissions/course/:id', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let query = JudgeState.createQueryBuilder();
    let isFiltered = false;

    let user = await User.fromName(req.query.submitter || '');
    if (user) {
      query.andWhere('user_id = :user_id', { user_id: user.id });
      isFiltered = true;
    } else if (req.query.submitter) {
      query.andWhere('user_id = :user_id', { user_id: 0 });
      isFiltered = true;
    }

    query.andWhere('type = 2');
    query.andWhere('type_info = :type_info', { type_info: courseID });

    if (req.query.lid) {
      let lessonIDs = await course.getLessons();
      let lid = parseInt(req.query.lid);
      if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');
      let lessonID = lessonIDs[lid - 1];
      let lesson = await Contest.findById(lessonID);
      if (!lesson) throw new ErrorMessage('无此课节。');
      let problemIDs = lesson.problems.split('|');
      query.andWhere('problem_id in (:problem_ids)', { problem_ids: problemIDs });
    }

    let minScore = parseInt(req.query.min_score);
    if (!isNaN(minScore)) query.andWhere('score >= :minScore', { minScore });
    let maxScore = parseInt(req.query.max_score);
    if (!isNaN(maxScore)) query.andWhere('score <= :maxScore', { maxScore });

    if (!isNaN(minScore) || !isNaN(maxScore)) isFiltered = true;

    if (req.query.language) {
      if (req.query.language === 'submit-answer') {
        query.andWhere(new TypeORM.Brackets(qb => {
          qb.orWhere('language = :language', { language: '' })
            .orWhere('language IS NULL');
        }));
        isFiltered = true;
      } else if (req.query.language === 'non-submit-answer') {
        query.andWhere('language != :language', { language: '' })
             .andWhere('language IS NOT NULL');
        isFiltered = true;
      } else {
        query.andWhere('language = :language', { language: req.query.language });
      }
    }

    if (req.query.status) {
      query.andWhere('status = :status', { status: req.query.status });
      isFiltered = true;
    }

    if (req.query.problem_id) {
      query.andWhere('problem_id = :problem_id', { problem_id: parseInt(req.query.problem_id) || 0 });
      isFiltered = true;
    }

    let judge_state, paginate;

    if (syzoj.config.submissions_page_fast_pagination) {
      const queryResult = await JudgeState.queryPageFast(query, syzoj.utils.paginateFast(
        req.query.currPageTop, req.query.currPageBottom, syzoj.config.page.judge_state
      ), -1, parseInt(req.query.page));

      judge_state = queryResult.data;
      paginate = queryResult.meta;
    } else {
      paginate = syzoj.utils.paginate(
        await JudgeState.countQuery(query),
        req.query.page,
        syzoj.config.page.judge_state
      );
      judge_state = await JudgeState.queryPage(paginate, query, { id: "DESC" }, true);
    }

    await judge_state.forEachAsync(async obj => {
      await obj.loadRelationships();
    });

    res.render('submissions', {
      course: course,
      items: judge_state.map(x => ({
        info: getSubmissionInfo(x, displayConfig),
        token: (x.pending && x.task_id != null) ? jwt.sign({
          taskId: x.task_id,
          type: 'rough',
          displayConfig: displayConfig
        }, syzoj.config.session_secret) : null,
        result: getRoughResult(x, displayConfig, true),
        running: false,
      })),
      paginate: paginate,
      pushType: 'rough',
      form: req.query,
      displayConfig: displayConfig,
      isFiltered: isFiltered,
      fast_pagination: syzoj.config.submissions_page_fast_pagination
    });
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

    const isCourseOwner = await course.hasOwnership(curUser);
    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let lessonIDs = await course.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);

    if (!lesson) throw new ErrorMessage('无此课节。');

    await lesson.loadRelationships();

    lesson.subtitle = await syzoj.utils.markdown(lesson.subtitle);
    lesson.information = await syzoj.utils.markdown(lesson.information);

    let problemIDs = await lesson.getProblems();
    let problems = await problemIDs.mapAsync(async id => await Problem.findById(id));

    await problems.forEachAsync(async problem => {
      problem.judge_state = await problem.getJudgeState(curUser, true, 2, course.id);
    });

    res.render('course_lesson', {
      course: course,
      lid: lid,
      lesson: lesson,
      problems: problems,
      isCourseOwner: isCourseOwner
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

    let lessonID = (lid > 0 ? lessonIDs[lid - 1] : 0);
    let lesson = await Contest.findById(lessonID);

    if (!lesson) {
      lesson = await Contest.create();
      lesson.id = 0;
    } else {
      await lesson.loadRelationships();
    }

    let problems = [];
    if (lesson.problems) {
      problems = await lesson.problems.split('|').mapAsync(async id => await Problem.findById(id));
    }

    res.render('course_lesson_edit', {
      course: course,
      lid: lid,
      lesson: lesson,
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

    let lessonID = (lid > 0 ? lessonIDs[lid - 1] : 0);
    let lesson = await Contest.findById(lessonID);

    if (!lesson) {
      lesson = await Contest.create();

      lesson.holder_id = curUser.id;
      lesson.teachers = '';
    } else {
      await lesson.loadRelationships();
    }

    if (!req.body.title.trim()) throw new ErrorMessage('课节名不能为空。');
    lesson.title = req.body.title;
    lesson.subtitle = req.body.subtitle;
    lesson.information = req.body.information;
    lesson.admins = '';
    if (!Array.isArray(req.body.problems)) req.body.problems = [req.body.problems];
    lesson.problems = req.body.problems.join('|');
    if (!['noi', 'ioi', 'usaco'].includes(req.body.type)) throw new ErrorMessage('无效的赛制。');
    lesson.type = req.body.type;
    lesson.hide_statistics = (lesson.type === 'noi');
    lesson.is_public = (req.body.is_public === 'on');

    await lesson.save();

    if (!lid) {
      lid = lessonIDs.length + 1;
      course.lessons += (lid > 1 ? "|" : "") + lesson.id;

      await course.save();

      return res.redirect(syzoj.utils.makeUrl(['course', course.id]));
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

    if (lid > 1) {
      [lessonIDs[lid-2], lessonIDs[lid-1]] = [lessonIDs[lid-1], lessonIDs[lid-2]];
      course.lessons = lessonIDs.join('|');
      await course.save();
    }

    res.redirect(syzoj.utils.makeUrl(['course', course.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/lesson/:lid/move_down', async (req, res) => {
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

    if (lid < lessonIDs.length) {
      [lessonIDs[lid-1], lessonIDs[lid]] = [lessonIDs[lid], lessonIDs[lid-1]];
      course.lessons = lessonIDs.join('|');
      await course.save();
    }

    res.redirect(syzoj.utils.makeUrl(['course', course.id]));
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

app.get('/course/:id/lesson/:lid/ranklist', async (req, res) => {
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
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
