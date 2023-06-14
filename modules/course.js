let Course = syzoj.model('course');
let Clazz = syzoj.model('clazz');
let Contest = syzoj.model('contest');
let ContestPlayer = syzoj.model('contest_player');
let ContestRanklist = syzoj.model('contest_ranklist');
let Problem = syzoj.model('problem');
let ProblemTag = syzoj.model('problem_tag');
let JudgeState = syzoj.model('judge_state');
let FormattedCode = syzoj.model('formatted_code');
let User = syzoj.model('user');
let Article = syzoj.model('article');

let Judger = syzoj.lib('judger');
let CodeFormatter = syzoj.lib('code_formatter');

const randomstring = require('randomstring');
const fs = require('fs-extra');
const jwt = require('jsonwebtoken');
const { getSubmissionInfo, getRoughResult, processOverallResult } = require('../libs/submissions_process');

const displayConfig = {
  showScore: true,
  showUsage: true,
  showCode: true,
  showResult: true,
  showOthers: true,
  showTestdata: true,
  showDetailResult: true,
  inContest: false,
  showRejudge: false
};

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

    let allClasses = await Clazz.queryAll(Clazz.createQueryBuilder());
    let myClasses = await allClasses.filterAsync(async x => await x.isParticipant(curUser));
    let myActiveClasses = await myClasses.filterAsync(async x => x.is_public || await x.isSupervisior(curUser));
    let myActiveClassIDs = myActiveClasses.filter(x => !x.isEnded()).map(x => x.id);

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
    query.orderBy('(CASE WHEN is_public THEN 2 ELSE CAST(teachers != \'\' AS SIGNED INTEGER) END)');
    query.addOrderBy('start_time', 'DESC');
    let activeClasses = await Clazz.queryPage(paginate, query);

    await activeClasses.forEachAsync(async x => {
      x.running = x.isRunning();
      x.teacher = await User.findById(await x.getMainTeacher());
      x.owner = await User.findById(await x.owner_id);
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
      x.owner = await User.findById(await x.owner_id);
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
    if (!isSupervisior) lessons = lessons.filter(x => x.is_public);

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

// [TODO]: add warning
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

    const isCourseOwner = await course.hasOwnership(curUser);
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
      isCourseOwner: isCourseOwner,
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

    const isCourseOwner = await course.hasOwnership(curUser);
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
      isCourseOwner: isCourseOwner,
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

    const isCourseOwner = await course.hasOwnership(curUser);
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
        return res.redirect(syzoj.utils.makeUrl(['course', course.id, 'problems']));
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
      isCourseOwner: isCourseOwner,
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

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let problemID = parseInt(req.params.pid);
    let problem = await Problem.findById(problemID);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');

    problem.allowedEdit = await problem.isAllowedEditBy(curUser);
    problem.allowedManage = await problem.isAllowedManageBy(curUser);

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let state = await problem.getJudgeState(curUser, false);

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

app.get('/course/:id/problem/:pid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

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
      problem.allowedEdit = await problem.isAllowedEditBy(curUser);
      if (!problem.allowedEdit) throw new ErrorMessage('您没有权限进行此操作。');
      problem.tags = await problem.getTags();
    }

    problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);

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

      let customID = parseInt(req.body.pid);
      if (customID) {
        if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
        // [TODO]: consider a better message
        if (parseInt(customID / 10000) != courseID) throw new ErrorMessage('题号范围错误。');
        problem.id = customID;
      } else if (problemID) {
        // [TODO]: consider a better message
        if (parseInt(problemID / 10000) != courseID) throw new ErrorMessage('题号范围错误。');
        problem.id = problemID;
      }

      problem.course_id = courseID;
      problem.user_id = curUser.id;
    } else {
      if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');
      if (!problem.isAllowedEditBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');

      let customID = parseInt(req.body.pid);
      if (customID && customID !== problemID) {
        if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
        // [TODO]: consider a better message
        if (parseInt(customID / 10000) != courseID) throw new ErrorMessage('题号范围错误。');
        await problem.changeID(customID);
      }
    }

    if (!req.body.title.trim()) throw new ErrorMessage('题目名不能为空。');
    problem.title = req.body.title;
    problem.description = req.body.description;
    problem.input_format = req.body.input_format;
    problem.output_format = req.body.output_format;
    problem.example = req.body.example;
    problem.limit_and_hint = req.body.limit_and_hint;

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

app.get('/course/:id/problem/:pid/import', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

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
      problem.new = true;
      problem.user_id = curUser.id;
    } else {
      if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');
      if (!await problem.isAllowedEditBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    problem.allowedEdit = await problem.isAllowedEditBy(res.locals.user);

    res.render('course_problem_import', {
      course: course,
      problem: problem
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/problem/:pid/import', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

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

      let customID = parseInt(req.body.pid);
      if (customID) {
        if (await Problem.findById(customID)) throw new ErrorMessage('ID 已被使用。');
        // [TODO]: consider a better message
        if (parseInt(customID / 10000) != courseID) throw new ErrorMessage('题号范围错误。');
        problem.id = customID;
      } else if (problemID) {
        // [TODO]: consider a better message
        if (parseInt(problemID / 10000) != courseID) throw new ErrorMessage('题号范围错误。');
        problem.id = problemID;
      }

      problem.course_id = courseID;
      problem.user_id = curUser.id;
    } else {
      if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');
      if (!await problem.isAllowedEditBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');
    }

    let request = require('request-promise');
    let url = require('url');

    let json = await request({
      uri: req.body.url + (req.body.url.endsWith('/') ? 'export' : '/export'),
      timeout: 1500,
      json: true
    });

    if (!json.success) throw new ErrorMessage('题目加载失败。', null, json.error);

    if (!json.obj.title.trim()) throw new ErrorMessage('题目名不能为空。');
    problem.title = json.obj.title;
    problem.description = json.obj.description;
    problem.input_format = json.obj.input_format;
    problem.output_format = json.obj.output_format;
    problem.example = json.obj.example;
    problem.limit_and_hint = json.obj.limit_and_hint;
    problem.time_limit = json.obj.time_limit;
    problem.memory_limit = json.obj.memory_limit;
    problem.file_io = json.obj.file_io;
    problem.file_io_input_name = json.obj.file_io_input_name;
    problem.file_io_output_name = json.obj.file_io_output_name;
    if (json.obj.type) problem.type = json.obj.type;

    let validateMsg = await problem.validate();
    if (validateMsg) throw new ErrorMessage('无效的题目数据配置。', null, validateMsg);

    await problem.save();

    let tagIDs = (await json.obj.tags.mapAsync(name => ProblemTag.findOne({ where: { name: String(name) } }))).filter(x => x).map(tag => tag.id);
    await problem.setTags(tagIDs);

    let download = require('download');
    let tmp = require('tmp-promise');
    let tmpFile = await tmp.file();

    try {
      let data = await download(req.body.url + (req.body.url.endsWith('/') ? 'testdata/download' : '/testdata/download'));
      await fs.writeFile(tmpFile.path, data);
      await problem.updateTestdata(tmpFile.path, true);
      if (json.obj.have_additional_file) {
        let additional_file = await download(req.body.url + (req.body.url.endsWith('/') ? 'download/additional_file' : '/download/additional_file'));
        await fs.writeFile(tmpFile.path, additional_file);
        await problem.updateFile(tmpFile.path, 'additional_file', true);
      }
    } catch (e) {
      syzoj.log(e);
    }

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'problem', problem.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/problem/:pid/upload', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/problem/:pid/upload', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/problem/:pid/manage', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let problemID = parseInt(req.params.pid);
    let problem = await Problem.findById(problemID);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');
    if (!await problem.isAllowedEditBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');

    await problem.loadRelationships();

    let testdata = await problem.listTestdata();
    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    problem.allowedEdit = await problem.isAllowedEditBy(curUser);

    res.render('course_problem_manage', {
      course: course,
      problem: problem,
      testdata: testdata,
      testcases: testcases
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/problem/:pid/manage', app.multer.fields([{ name: 'testdata', maxCount: 1 }, { name: 'additional_file', maxCount: 1 }]), async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let problemID = parseInt(req.params.pid);
    let problem = await Problem.findById(problemID);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');
    if (!await problem.isAllowedEditBy(curUser)) throw new ErrorMessage('您没有权限进行此操作。');

    await problem.loadRelationships();

    problem.time_limit = req.body.time_limit;
    problem.memory_limit = req.body.memory_limit;
    if (req.body.type === 'traditional') {
      problem.file_io = req.body.io_method === 'file-io';
      problem.file_io_input_name = req.body.file_io_input_name;
      problem.file_io_output_name = req.body.file_io_output_name;
    }

    if (problem.type === 'submit-answer' && req.body.type !== 'submit-answer' || problem.type !== 'submit-answer' && req.body.type === 'submit-answer') {
      if (await JudgeState.count({ problem_id: id }) !== 0) {
        throw new ErrorMessage('已有提交的题目不允许在提交答案和非提交答案之间更改。');
      }
    }
    problem.type = req.body.type;

    let validateMsg = await problem.validate();
    if (validateMsg) throw new ErrorMessage('无效的题目数据配置。', null, validateMsg);

    if (req.files['testdata']) {
      await problem.updateTestdata(req.files['testdata'][0].path, true);
    }

    if (req.files['additional_file']) {
      await problem.updateFile(req.files['additional_file'][0].path, 'additional_file', true);
    }

    await problem.save();

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'problem', problem.id, 'manage']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// [TODO]: add warning
app.post('/course/:id/problem/:pid/approval', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isCourseOwner = await course.hasOwnership(curUser);

    if (!isCourseOwner) throw new ErrorMessage('您没有权限进行此操作。');

    let problemID = parseInt(req.params.pid);
    let problem = await Problem.findById(problemID);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');

    problem.is_public = true;
    problem.publicizer_id = curUser.id;
    problem.publicize_time = new Date();
    await problem.save();

    JudgeState.query('UPDATE `judge_state` SET `is_public` = ' + problem.is_public + ' WHERE `problem_id` = ' + problem.id);

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'problem', problem.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// [TODO]: duplication detect
app.post('/course/:id/problem/:pid/submit', app.multer.fields([{ name: 'answer', maxCount: 1 }]), async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    let problemID = parseInt(req.params.pid);
    let problem = await Problem.findById(problemID);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (problem.course_id !== course.id) throw new ErrorMessage('错误的题目。');

    if (problem.type !== 'submit-answer' && !syzoj.config.enabled_languages.includes(req.body.language)) throw new ErrorMessage('不支持该语言。');

    let judge_state;
    if (problem.type === 'submit-answer') {
      let File = syzoj.model('file'), path;
      if (!req.files['answer']) {
        // Submited by editor
        try {
          path = await File.zipFiles(JSON.parse(req.body.answer_by_editor));
        } catch (e) {
          throw new ErrorMessage('无法解析提交数据。');
        }
      } else {
        if (req.files['answer'][0].size > syzoj.config.limit.submit_answer) throw new ErrorMessage('答案文件太大。');
        path = req.files['answer'][0].path;
      }

      let file = await File.upload(path, 'answer');
      let size = await file.getUnzipSize();

      if (size > syzoj.config.limit.submit_answer) throw new ErrorMessage('答案文件太大。');

      if (!file.md5) throw new ErrorMessage('上传答案文件失败。');
      judge_state = await JudgeState.create({
        submit_time: parseInt((new Date()).getTime() / 1000),
        status: 'Unknown',
        task_id: randomstring.generate(10),
        code: file.md5,
        code_length: size,
        language: null,
        user_id: curUser.id,
        problem_id: id,
        is_public: problem.is_public
      });
    } else {
      let code;
      if (req.files['answer']) {
        if (req.files['answer'][0].size > syzoj.config.limit.submit_code) throw new ErrorMessage('代码文件太大。');
        code = (await fs.readFile(req.files['answer'][0].path)).toString();
      } else {
        if (Buffer.from(req.body.code).length > syzoj.config.limit.submit_code) throw new ErrorMessage('代码太长。');
        code = req.body.code;
      }

      judge_state = await JudgeState.create({
        submit_time: parseInt((new Date()).getTime() / 1000),
        status: 'Unknown',
        task_id: randomstring.generate(10),
        code: code,
        code_length: Buffer.from(code).length,
        language: req.body.language,
        user_id: curUser.id,
        problem_id: problemID,
        is_public: problem.is_public
      });
    }

    let contestID;
    let contest;
    let lid = parseInt(req.query.lesson);
    if (lid) {
      let lessonIDs = await course.getLessons();
      if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');
      contestID = lessonIDs[lid - 1];
      contest = await Contest.findById(contestID);
      if (!contest) throw new ErrorMessage('无此课节。');
      if (contest.course_id !== courseID) throw new ErrorMessage('错误的课节。');
      let problemIDs = await contest.getProblems();
      if (!problemIDs.includes(problemID)) throw new ErrorMessage('无此题目。');

      judge_state.type = 1;
      judge_state.type_info = contestID;
      await judge_state.save();
    } else {
      judge_state.type = 2;
      judge_state.type_info = courseID;
      await judge_state.save();
    }
    await judge_state.updateRelatedInfo(true);

    if (problem.type !== 'submit-answer' && syzoj.languages[req.body.language].format) {
      let key = syzoj.utils.getFormattedCodeKey(judge_state.code, req.body.language);
      let formattedCode = await FormattedCode.findOne({
        where: {
          key: key
        }
      });

      if (!formattedCode) {
        let formatted = await CodeFormatter(judge_state.code, syzoj.languages[req.body.language].format);
        if (formatted) {
          formattedCode = await FormattedCode.create({
            key: key,
            code: formatted
          });

          try {
            await formattedCode.save();
          } catch (e) {}
        }
      }
    }

    try {
      await Judger.judge(judge_state, problem, contestID ? 3 : 2);
      judge_state.pending = true;
      judge_state.status = 'Waiting';
      await judge_state.save();
    } catch (err) {
      throw new ErrorMessage(`无法开始评测：${err.toString()}`);
    }

    if (contest) {
      res.redirect(syzoj.utils.makeUrl(['course', course.id, 'submissions'], { lesson: lid }));
    } else {
      res.redirect(syzoj.utils.makeUrl(['course', course.id, 'submissions']));
    }
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/submissions', async (req, res) => {
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

    let contest = null;
    if (!req.query.lesson) {
      query.andWhere('type = 2');
      query.andWhere('type_info = :type_info', { type_info: courseID });
    } else {
      let lessonIDs = await course.getLessons();
      let lid = parseInt(req.query.lesson);
      if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');
      let contestID = lessonIDs[lid - 1];
      contest = await Contest.findById(contestID);
      if (!contest) throw new ErrorMessage('无此课节。');
      if (contest.course_id !== courseID) throw new ErrorMessage('错误的课节。');
      query.andWhere('type = 1');
      query.andWhere('type_info = :type_info', { type_info: contestID });
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

    res.render('course_submissions', {
      course: course,
      lid: req.query.lesson,
      contest: contest,
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

    let contestID = lessonIDs[lid - 1];
    let contest = await Contest.findById(contestID);

    if (!contest) throw new ErrorMessage('无此课节。');
    if (contest.course_id !== courseID) throw new ErrorMessage('错误的课节。');

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
            // [TODO]: ???
            if (!contest.ended && !await problem.problem.isAllowedEditBy(curUser) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
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
      course: course,
      lid: lid,
      contest: contest,
      problems: problems,
      hasStatistics: hasStatistics,
      // [TODO]: isSupervisior always true???
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

// [TODO]: add warning
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

app.get('/course/:id/lesson/:lid/problem/:pid', async (req, res) => {
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

    if (!contest) throw new ErrorMessage('无此课节。');
    if (contest.course_id !== courseID) throw new ErrorMessage('错误的课节。');

    let problemIDs = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problemIDs.length) throw new ErrorMessage('无此题目。');

    let problemID = problemIDs[pid - 1];
    let problem = await Problem.findById(problemID);

    if (!problem) throw new ErrorMessage('无此题目。');
    if (problem.course_id !== courseID) throw new ErrorMessage('错误的题目。');

    await problem.loadRelationships();

    problem.specialJudge = await problem.hasSpecialJudge();

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let state = await problem.getJudgeState(res.locals.user, false);
    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    await problem.loadRelationships();

    res.render('course_problem', {
      course: course,
      lid: lid,
      contest: contest,
      pid: pid,
      problem: problem,
      state: state,
      lastLanguage: res.locals.user ? await res.locals.user.getLastSubmitLanguage() : null,
      testcases: testcases
    });
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
    const allowedManageClass = (curUser && await curUser.hasPrivilege('manage_class'));

    if (!isSupervisior && !allowedManageClass) throw new ErrorMessage('您没有权限进行此操作。');

    course.subtitle = await syzoj.utils.markdown(course.subtitle);

    let query = Clazz.createQueryBuilder();
    query.andWhere('course_id = :course_id', { course_id: courseID });

    let paginate = syzoj.utils.paginate(
      await Clazz.countForPagination(query), req.query.page, syzoj.config.page.course);
    query.orderBy('(CASE WHEN is_public THEN 2 ELSE CAST(teachers != \'\' AS SIGNED INTEGER) END)');
    query.addOrderBy('start_time', 'DESC');
    let classes = await Clazz.queryPage(paginate, query);

    await classes.forEachAsync(async x => {
      x.running = x.isRunning();
      x.ended = x.isEnded();
      x.teacher = await User.findById(await x.getMainTeacher());
      x.owner = await User.findById(await x.owner_id);
    });

    res.render('course_classes', {
      course: course,
      isCourseOwner: isCourseOwner,
      allowedManageClass: allowedManageClass,
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
      // if clazz does not exist, only course owner or class manager can create one
      if (!curUser || !(await course.hasOwnership(curUser) || await curUser.hasPrivilege('manage_class'))) {
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
      // if clazz does not exist, only course owner or class manager can create one
      if (!curUser || !(await course.hasOwnership(curUser) || await curUser.hasPrivilege('manage_class'))) {
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
    if (curUser.is_admin) {
      clazz.owner_id = parseInt(req.body.owner);
    }
    if (await course.hasOwnership(curUser)) {
      if (!Array.isArray(req.body.teachers)) req.body.teachers = [req.body.teachers];
      clazz.teachers = req.body.teachers.join('|');
    }
    if (curUser.is_admin && req.body.is_public !== 'on') {
      clazz.is_public = false;
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

// [TODO]: add warning
app.post('/course/:id/class/:cid/approval', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let courseID = parseInt(req.params.id);
    let course = await Course.findById(courseID);

    if (!course) throw new ErrorMessage('无此课程。');

    let classID = parseInt(req.params.cid);
    let clazz = await Clazz.findById(classID);

    if (!clazz) throw new ErrorMessage('无此班级。');
    if (clazz.course_id !== course.id) throw new ErrorMessage('错误的课程。');

    await clazz.loadRelationships();
    // only system administrators can approve class
    if (!curUser || !curUser.is_admin) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    if (!clazz.teachers.trim()) throw new ErrorMessage('请先设定任课教师。');

    await clazz.loadRelationships();

    // [TODO]: auto create lessons when approved
    if (!clazz.lessons.trim()) {
      let lessonIDs = await course.getLessons();
      let lessons = await lessonIDs.mapAsync(async id => {
        let contest = await Contest.create();
        let contestID = contest.id;
        let ranklist = await ContestRanklist.create();
        ranklist.ranking_params = {};
        await ranklist.save();
        contest = await Contest.create(await Contest.findById(id));

        contest.id = contestID;
        contest.start_time = clazz.start_time;
        contest.end_time = clazz.end_time;
        contest.ranklist_id = ranklist.id;
        return await contest.save();
      });
      clazz.lessons = lessons.map(x => x.id).join('|');
    }
    clazz.is_public = true;

    await clazz.save();

    res.redirect(syzoj.utils.makeUrl(['course', clazz.course_id, 'class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// [TODO]: add warning
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

    let lessonIDs = await clazz.getLessons();

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
            // [TODO]: ???
            if (!contest.ended && !await problem.problem.isAllowedEditBy(curUser) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
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
      course: course,
      clazz: clazz,
      lid: lid,
      contest: contest,
      problems: problems,
      hasStatistics: hasStatistics,
      isCourseOwner: isCourseOwner,
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

    let lessonIDs = await clazz.getLessons();

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
      clazz: clazz,
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

app.post('/course/:id/class/:cid/lesson/:lid/edit', async (req, res) => {
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

    let lessonIDs = await clazz.getLessons();

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
    contest.start_time = syzoj.utils.parseDate(req.body.start_time);
    contest.end_time = syzoj.utils.parseDate(req.body.end_time);
    // [TODO]: update logic about is_public
    contest.is_public = (req.body.is_public === 'on');

    await contest.save();

    if (!lid) {
      lid = lessonIDs.length + 1;
      clazz.lessons += (lid > 1 ? "|" : "") + contest.id;

      await clazz.save();
    }

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'class', clazz.id, 'lesson', lid]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/class/:cid/lesson/:lid/move_up', async (req, res) => {
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

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 0 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    if (lid > 1) {
      [lessonIDs[lid-2], lessonIDs[lid-1]] = [lessonIDs[lid-1], lessonIDs[lid-2]];
      clazz.lessons = lessonIDs.join('|');
      await clazz.save();
    }

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/course/:id/class/:cid/lesson/:lid/move_down', async (req, res) => {
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

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 0 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    if (lid < lessonIDs.length) {
      [lessonIDs[lid-1], lessonIDs[lid]] = [lessonIDs[lid], lessonIDs[lid-1]];
      clazz.lessons = lessonIDs.join('|');
      await clazz.save();
    }

    res.redirect(syzoj.utils.makeUrl(['course', course.id, 'class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// [TODO]: add warning
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
