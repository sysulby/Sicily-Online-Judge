let Course = syzoj.model('course');
let Clazz = syzoj.model('clazz');
let ClazzStudent = syzoj.model('clazz_student');
let Contest = syzoj.model('contest');
let ContestRanklist = syzoj.model('contest_ranklist');
let ContestPlayer = syzoj.model('contest_player');
let Problem = syzoj.model('problem');
let JudgeState = syzoj.model('judge_state');
let User = syzoj.model('user');
let Resume = syzoj.model('resume');

const jwt = require('jsonwebtoken');
const { getSubmissionInfo, getRoughResult, processOverallResult } = require('../libs/submissions_process');

const grade = ['其他', '一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三'];
const contact_relationship = ['其他', '本人', '父母', '教练'];

app.get('/class/:id', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!await clazz.isParticipant(curUser)) {
        return res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'register']));
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    const isCourseOwner = await course.hasOwnership(curUser);
    const isClassOwner = await clazz.hasOwnership(curUser);
    const isMainTeacher = isClassOwner || curUser.id.toString() === await clazz.getMainTeacher();

    let student = null;
    if (!isSupervisior) {
      student = await ClazzStudent.findInClazz({
        class_id: classID,
        user_id: curUser.id
      });
    }
    const isStudent = (student && student.status === 'Accepted');
    const isCandidate = (student && student.status === 'Waiting');

    clazz.subtitle = await syzoj.utils.markdown(clazz.subtitle);
    if (isSupervisior || isStudent) {
      clazz.information = await syzoj.utils.markdown(clazz.information);
    } else {
      clazz.information = null;
      if (!isCandidate) clazz.reg_feedback = (student.feedback ? await syzoj.utils.markdown(student.feedback) : '无');
    }
    clazz.running = clazz.isRunning();
    clazz.ended = clazz.isEnded();

    let lessonIDs = await clazz.getLessons();
    let lessons = await lessonIDs.mapAsync(async id => await Contest.findById(id));

    res.render('clazz', {
      course: course,
      clazz: clazz,
      isSupervisior: isSupervisior,
      isCourseOwner: isCourseOwner,
      isClassOwner: isClassOwner,
      isMainTeacher: isMainTeacher,
      isStudent: isStudent,
      isCandidate: isCandidate,
      lessons: lessons
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);

    let course = await Course.findById(clazz ? clazz.course_id : req.query.course);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const allowedManageClass = (curUser && await curUser.hasPrivilege('manage_class'));

    if (!clazz) {
      // if clazz does not exist, only course owner or class manager can create one
      if (!isCourseOwner && !allowedManageClass) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      clazz = await Clazz.create();
      clazz.id = 0;
      clazz.reg_info = '';
    } else {
      // if clazz exists, both system administrators and clazz owner can edit it.
      if (!await clazz.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
    }

    let owner = curUser;
    if (clazz.owner_id) owner = await User.findById(clazz.owner_id);
    let teachers = [];
    if (clazz.teachers) {
      teachers = await clazz.teachers.split('|').mapAsync(async id => await User.findById(id));
    }

    res.render('clazz_edit', {
      course: course,
      clazz: clazz,
      isCourseOwner: isCourseOwner,
      allowedManageClass: allowedManageClass,
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

app.post('/class/:id/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);

    let course = await Course.findById(clazz ? clazz.course_id : req.query.course);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const allowedManageClass = (curUser && await curUser.hasPrivilege('manage_class'));

    if (!clazz) {
      // if clazz does not exist, only course owner or class manager can create one
      if (!isCourseOwner && !allowedManageClass) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      clazz = await Clazz.create();
      clazz.owner_id = curUser.id;
      clazz.teachers = '';
      clazz.lessons = '';
      clazz.course_id = course.id;
      clazz.is_public = 0;
    } else {
      // if clazz exists, both system administrators and clazz owner can edit it.
      if (!await clazz.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
    }

    if (!req.body.title.trim()) throw new ErrorMessage('班级名不能为空。');
    clazz.title = req.body.title;
    clazz.information = req.body.information;
    if (req.body.start_time.trim()) clazz.start_time = syzoj.utils.parseDate(req.body.start_time); // 8:00:00
    else throw new ErrorMessage('请指定开课日期');
    if (req.body.start_time.trim()) clazz.end_time = syzoj.utils.parseDate(req.body.end_time) + 3600 * 14; // 22:00:00
    else throw new ErrorMessage('请指定结课日期');
    if (clazz.start_time >= clazz.end_time) throw new ErrorMessage('开课日期应早于结课日期');

    clazz.reg_info = req.body.reg_info;
    if (req.body.reg_start_time.trim()) clazz.reg_start_time = syzoj.utils.parseDate(req.body.reg_start_time);
    else clazz.reg_start_time = clazz.start_time - 3600 * 24 * 10;
    if (req.body.reg_end_time.trim()) clazz.reg_end_time = syzoj.utils.parseDate(req.body.reg_end_time);
    else clazz.reg_end_time = clazz.end_time;

    if (allowedManageClass) {
      clazz.owner_id = parseInt(req.body.owner);
    }
    if (isCourseOwner) {
      if (!Array.isArray(req.body.teachers)) req.body.teachers = [req.body.teachers];
      clazz.teachers = req.body.teachers.join('|');
    }
    if (curUser.is_admin && req.body.is_public !== 'on') {
      clazz.is_public = false;
    }

    await clazz.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/students', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) throw new ErrorMessage('您没有权限进行此操作。');

    const isClassOwner = await clazz.hasOwnership(curUser);

    let allParticipants = await ClazzStudent.queryAll(
      ClazzStudent.createQueryBuilder().where('class_id = :class_id', { class_id: classID })
    );
    await allParticipants.forEachAsync(async x => {
      x.user = await User.findById(x.user_id);
      x.resume = await Resume.findById(x.user_id);
      x.resume.grade = grade[x.resume.graduation_year];
      x.resume.contact_relationship = contact_relationship[x.resume.relationship];
      if (!x.resume.award1 || !x.resume.award1.trim()) x.resume.award1 = '无';
      if (!x.resume.award2 || !x.resume.award2.trim()) x.resume.award2 = '无';
      if (!x.resume.award3 || !x.resume.award3.trim()) x.resume.award3 = '无';
      if (!x.resume.award4 || !x.resume.award4.trim()) x.resume.award4 = '无';
      x.resume_file = await x.resume.loadResumeFile();
    });

    let candidates = allParticipants.filter(x => x.status === 'Waiting');
    let students = allParticipants.filter(x => x.status === 'Accepted');
    let removed_students = allParticipants.filter(x => x.status === 'Removed');
    let rejected_candidates = allParticipants.filter(x => x.status === 'Rejected');

    clazz.subtitle = await syzoj.utils.markdown(clazz.subtitle);

    res.render('clazz_students', {
      course: course,
      clazz: clazz,
      isClassOwner: isClassOwner,
      candidates: candidates,
      students: students,
      removed_students: removed_students,
      rejected_candidates: rejected_candidates
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/student/:cid/approval', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    if (!await clazz.hasOwnership(curUser)) throw new ErrorMessage('您没有权限进行此操作。');

    let student = await ClazzStudent.findById(parseInt(req.params.cid));
    if (!student || student.class_id !== classID) throw new ErrorMessage('非班级学员。');

    student.status = 'Accepted';
    student.feedback = null;
    student.last_modified = syzoj.utils.getCurrentDate();

    await student.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'students']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/student/:cid/reject', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    if (!await clazz.hasOwnership(curUser)) throw new ErrorMessage('您没有权限进行此操作。');

    let student = await ClazzStudent.findById(parseInt(req.params.cid));
    if (!student || student.class_id !== classID) throw new ErrorMessage('非班级学员。');
    if (!student.status === 'Waiting')  throw new ErrorMessage('无法执行此操作。');

    student.status = 'Rejected';
    student.feedback = 'sad story';
    student.last_modified = syzoj.utils.getCurrentDate();

    await student.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'students']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/student/:cid/remove', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    if (!await clazz.hasOwnership(curUser)) throw new ErrorMessage('您没有权限进行此操作。');

    let student = await ClazzStudent.findById(parseInt(req.params.cid));
    if (!student || student.class_id !== classID) throw new ErrorMessage('非班级学员。');
    if (!student.status === 'Accepted')  throw new ErrorMessage('无法执行此操作。');

    student.status = 'Removed';
    student.feedback = 'sad story';
    student.last_modified = syzoj.utils.getCurrentDate();

    await student.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'students']));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/register', async (req, res) => {
  try {
    const curUser = res.locals.user;
    if (!curUser) throw new ErrorMessage('请先登录。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (isSupervisior || await clazz.isParticipant(curUser)) {
      return res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
    }

    if (!clazz.is_public) throw new ErrorMessage('此班级尚未公开，请耐心等待。');

    clazz.subtitle = await syzoj.utils.markdown(clazz.subtitle);
    clazz.reg_info = await syzoj.utils.markdown(clazz.reg_info);

    let student = await ClazzStudent.findInClazz({
      class_id: classID,
      user_id: curUser.id
    });
    if (student) clazz.reg_feedback = (student.feedback ? await syzoj.utils.markdown(student.feedback) : '无');

    let resume = await Resume.findById(curUser.id);
    let resume_file = null;
    if (resume) {
      resume.grade = grade[resume.graduation_year];
      resume.contact_relationship = contact_relationship[resume.relationship];
      if (!resume.award1 || !resume.award1.trim()) resume.award1 = '无';
      if (!resume.award2 || !resume.award2.trim()) resume.award2 = '无';
      if (!resume.award3 || !resume.award3.trim()) resume.award3 = '无';
      if (!resume.award4 || !resume.award4.trim()) resume.award4 = '无';
      resume_file = await resume.loadResumeFile();
    }

    res.render('clazz_register', {
      course: course,
      clazz: clazz,
      resume: resume,
      resume_file: resume_file
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/register', async (req, res) => {
  try {
    const curUser = res.locals.user;
    if (!curUser) throw new ErrorMessage('请先登录。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (isSupervisior || await clazz.isParticipant(curUser)) {
      return res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
    }

    if (!clazz.is_public) throw new ErrorMessage('此班级尚未公开，请耐心等待。');

    if (syzoj.utils.getCurrentDate() < clazz.reg_start_time) throw new ErrorMessage('报名尚未开始，请耐心等待。');
    if (syzoj.utils.getCurrentDate() >= clazz.reg_end_time) throw new ErrorMessage('报名已经结束，敬请期待下期课程。');

    let resume = await Resume.findById(curUser.id);
    if (!resume) throw new ErrorMessage('请先完善资料。');

    let student = await ClazzStudent.findInClazz({
      class_id: classID,
      user_id: curUser.id
    });
    if (student) return res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'register']));

    student = await ClazzStudent.create();
    student.class_id = clazz.id;
    student.user_id = curUser.id;
    student.reg_time = syzoj.utils.getCurrentDate();
    student.last_modified = student.reg_time;
    student.status = 'Waiting';

    await student.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/approval', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    // only system administrators can approve class
    if (!curUser || !curUser.is_admin) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    if (!clazz.teachers.trim()) throw new ErrorMessage('请先设定任课教师。');

    // only public lessons will be synced
    if (!clazz.lessons.trim()) {
      let lessonIDs = await course.getLessons();
      let templateLessons = (await lessonIDs.mapAsync(async id => await Contest.findById(id))).filter(x => x.is_public);
      let lessons = await templateLessons.mapAsync(async contest => {
        let lessonID = (await Contest.create()).id;
        let lesson = await Contest.create(contest);

        lesson.id = lessonID;
        lesson.start_time = clazz.start_time;
        lesson.end_time = clazz.end_time;
        if (contest.type === 'usaco') {
          lesson.duration = contest.duration;
          lesson.reg_info = '请独立完成试题。';
          lesson.reg_token = Math.floor(100000 + Math.random() * 900000).toString();
        }
        lesson.is_public = false;
        lesson.hide_statistics = (contest.type === 'noi');

        lesson.holder_id = classID;
        let ranklist = await ContestRanklist.create();
        ranklist.ranking_params = {};
        await ranklist.save();
        lesson.ranklist_id = ranklist.id;

        return await lesson.save();
      });
      clazz.lessons = lessons.map(x => x.id).join('|');
    }
    clazz.is_public = true;

    await clazz.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/delete', async (req, res) => {
  try {
    throw new ErrorMessage('功能开发中，请耐心等待 (´∀ `)');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/files', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    res.render('clazz_files', {
      course: course,
      clazz: clazz,
      fileList: await course.listCourseFile()
    });
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

function downloadOrRedirect(req, res, filename, sendName) {
  if (syzoj.config.site_for_download) {
    res.redirect(syzoj.config.site_for_download + syzoj.utils.makeUrl(['api', 'v2', 'download', jwt.sign({
      filename: filename,
      sendName: sendName,
      originUrl: syzoj.utils.getCurrentLocation(req)
    }, syzoj.config.session_secret, {
      expiresIn: '2m'
    })]));
  } else {
    res.download(filename, sendName);
  }
}

app.get('/class/:id/files/download/:filename?', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    if (!req.params.filename) throw new ErrorMessage('请指定文件名。');

    let path = require('path');
    let filename = path.join(course.getCourseFilePath(), req.params.filename);
    if (!await syzoj.utils.isFile(filename)) throw new ErrorMessage('文件不存在。');

    downloadOrRedirect(req, res, filename, path.basename(filename));
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/lesson/:lid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    const isCourseOwner = await course.hasOwnership(curUser);
    const isClassOwner = await clazz.hasOwnership(curUser);
    const isMainTeacher = isClassOwner || (curUser && curUser.id.toString() === await clazz.getMainTeacher());

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');
    await lesson.loadRelationships();

    if (!lesson.is_public && !isSupervisior) throw new ErrorMessage('课节尚未开放，请稍后再试。');

    let player = await ContestPlayer.findInContest({
      contest_id: lesson.id,
      user_id: curUser.id
    });

    lesson.running = lesson.isRunning();
    lesson.ended = lesson.isEnded();
    lesson.unveiled = isSupervisior || (player && (lesson.running || lesson.ended));
    lesson.subtitle = await syzoj.utils.markdown(lesson.subtitle);
    lesson.information = await syzoj.utils.markdown(lesson.information);
    if (lesson.type === 'usaco' && !isSupervisior && player) {
      if (syzoj.utils.getCurrentDate() >= player.reg_time + lesson.duration) lesson.running = false;
      if (lesson.unveiled) {
        // Update lesson period to running period for player.
        if (lesson.end_time == null || player.reg_time < lesson.end_time) lesson.start_time = player.reg_time;
        if (lesson.end_time == null || player.reg_time + lesson.duration < lesson.end_time) lesson.end_time = player.reg_time + lesson.duration;
      }
    }

    if (!isSupervisior && !player) {
      return res.render('clazz_lesson', {
        course: course,
        clazz: clazz,
        lid: lid,
        lesson: lesson,
        isSupervisior: isSupervisior,
        isCourseOwner: isCourseOwner,
        isMainTeacher: isMainTeacher,
        isParticipant: false
      });
    }

    let problemIDs = await lesson.getProblems();
    let problems = await problemIDs.mapAsync(async id => await Problem.findById(id));

    problems = problems.map(x => ({ problem: x, status: null, judge_id: null, statistics: null }));
    if (player) {
      for (let problem of problems) {
        if (lesson.type === 'noi') {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.findById(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            if (!lesson.ended && !await problem.problem.isAllowedEditBy(curUser) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
              problem.status = 'Submitted';
            }
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
          }
        } else {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.findById(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
            await lesson.loadRelationships();
            let multiplier = lesson.ranklist.ranking_params[problem.problem.id] || 1.0;
            problem.feedback = (judge_state.score * multiplier).toString() + ' / ' + (100 * multiplier).toString();
          }
        }
      }
    }

    let hasStatistics = false;
    if (lesson.type === 'ioi' || lesson.type === 'usaco' || lesson.ended) {
      hasStatistics = true;

      await lesson.loadRelationships();
      let players = await lesson.ranklist.getPlayers();
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

    res.render('clazz_lesson', {
      course: course,
      clazz: clazz,
      lid: lid,
      lesson: lesson,
      isSupervisior: isSupervisior,
      isCourseOwner: isCourseOwner,
      isMainTeacher: isMainTeacher,
      isParticipant: true,
      problems: problems,
      hasStatistics: hasStatistics
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/lesson/:lid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const isClassOwner = await clazz.hasOwnership(curUser);
    const isMainTeacher = isClassOwner || (curUser && curUser.id.toString() === await clazz.getMainTeacher());

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 0 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = (lid > 0 ? lessonIDs[lid - 1] : 0);
    let lesson = await Contest.findById(lessonID);

    if (!lesson) {
      // if lesson does not exist, only course owner or class manager can create one
      if (!isCourseOwner) throw new ErrorMessage('您没有权限进行此操作。');

      lesson = await Contest.create();
      lesson.id = 0;
      lesson.reg_info = '请独立完成试题。';
      lesson.reg_token = Math.floor(100000 + Math.random() * 900000).toString();
    } else {
      // if lesson exists, system administrators and clazz owner and main teacher can edit it.
      if (!isMainTeacher) throw new ErrorMessage('您没有权限进行此操作。');

      await lesson.loadRelationships();
    }

    let problems = [];
    if (lesson.problems) {
      problems = await lesson.problems.split('|').mapAsync(async id => await Problem.findById(id));
    }

    res.render('clazz_lesson_edit', {
      course: course,
      clazz: clazz,
      isCourseOwner: isCourseOwner,
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

app.post('/class/:id/lesson/:lid/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isCourseOwner = await course.hasOwnership(curUser);
    const isClassOwner = await clazz.hasOwnership(curUser);
    const isMainTeacher = isClassOwner || (curUser && curUser.id.toString() === await clazz.getMainTeacher());

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 0 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = (lid > 0 ? lessonIDs[lid - 1] : 0);
    let lesson = await Contest.findById(lessonID);
    let ranklist = null;

    if (!lesson) {
      // if lesson does not exist, only course owner or class manager can create one
      if (!isCourseOwner) throw new ErrorMessage('您没有权限进行此操作。');

      if (lid) throw new ErrorMessage('系统错误。');

      lesson = await Contest.create();
      lesson.holder_id = classID;
      ranklist = await ContestRanklist.create();
    } else {
      // if lesson exists, system administrators and clazz owner and main teacher can edit it.
      if (!isMainTeacher) throw new ErrorMessage('您没有权限进行此操作。');

      await lesson.loadRelationships();
      ranklist = lesson.ranklist;
    }

    if (isCourseOwner) {
      if (!['noi', 'ioi', 'usaco'].includes(req.body.type)) throw new ErrorMessage('无效的赛制。');
      lesson.type = req.body.type;
      if (!req.body.title.trim()) throw new ErrorMessage('比赛名不能为空。');
      lesson.title = req.body.title;
      lesson.subtitle = req.body.subtitle;
      if (lesson.type === 'usaco') {
        if (!req.body.duration.trim()) throw new ErrorMessage('请指定持续时间。');
        lesson.duration = syzoj.utils.parseTime(req.body.duration);
      }
      if (!Array.isArray(req.body.problems)) req.body.problems = [req.body.problems];
      lesson.problems = req.body.problems.join('|');

      try {
        ranklist.ranking_params = JSON.parse(req.body.ranking_params);
      } catch (e) {
        ranklist.ranking_params = {};
      }
      await ranklist.save();
      lesson.ranklist_id = ranklist.id;
    }

    lesson.information = req.body.information;
    lesson.start_time = !req.body.start_time.trim() ? clazz.start_time :
      Math.max(syzoj.utils.parseDate(req.body.start_time), clazz.start_time);
    lesson.end_time = !req.body.end_time.trim() ? clazz.end_time :
      Math.min(syzoj.utils.parseDate(req.body.end_time), clazz.end_time);
    lesson.reg_info = req.body.reg_info;
    lesson.reg_token = req.body.reg_token;
    lesson.is_public = req.body.is_public === 'on';
    lesson.hide_statistics = req.body.hide_statistics === 'on';

    await lesson.save();

    if (!lid) {
      lid = lessonIDs.length + 1;
      clazz.lessons += (lid > 1 ? "|" : "") + lesson.id;

      await clazz.save();

      return res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
    }

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'lesson', lid]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/lesson/:lid/import', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    // both system administrators and course supervisior who is clazz owner can edit it.
    if (!curUser || !(await course.isSupervisior(curUser) && await clazz.hasOwnership(curUser))) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 0 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessons = await (await course.getLessons()).mapAsync(async id => await Contest.findById(id));

    res.render('clazz_lesson_import', {
      course: course,
      clazz: clazz,
      lid: lid,
      lessons: lessons
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/lesson/:lid/import', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    // both system administrators and course supervisior who is clazz owner can edit it.
    if (!curUser || !(await course.isSupervisior(curUser) && await clazz.hasOwnership(curUser))) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 0 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let contest = await Contest.findById(req.body.lesson);
    if (!contest || contest.holder_id !== course.id) throw new ErrorMessage('该课节不可导入。');

    let lessonID = (lid > 0 ? lessonIDs[lid - 1] : 0);
    let lesson = await Contest.findById(lessonID);

    if (!lesson) {
      if (lid) throw new ErrorMessage('系统错误。');

      lessonID = (await Contest.create()).id;
      lesson = await Contest.create(contest);
      lesson.id = lessonID;

      lesson.start_time = clazz.start_time;
      lesson.end_time = clazz.end_time;
      if (contest.type === 'usaco') {
        lesson.duration = contest.duration;
        lesson.reg_info = '请独立完成试题。';
        lesson.reg_token = Math.floor(100000 + Math.random() * 900000).toString();
      }
      lesson.is_public = false;
      lesson.hide_statistics = (contest.type === 'noi');

      lesson.holder_id = classID;
      let ranklist = await ContestRanklist.create();
      ranklist.ranking_params = {};
      await ranklist.save();
      lesson.ranklist_id = ranklist.id;

      await lesson.save();
    } else {
      if (lesson.is_public) throw new ErrorMessage('无法覆盖已开放的课节。');
      if (lesson.type !== contest.type) throw new ErrorMessage('课节类型不一致。');

      lesson.title = contest.title;
      lesson.subtitle = contest.subtitle;
      if (contest.type === 'usaco') lesson.duration = contest.duration;
      lesson.problems = contest.problems;

      await lesson.save();
    }

    if (!lid) {
      lid = lessonIDs.length + 1;
      clazz.lessons += (lid > 1 ? "|" : "") + lesson.id;

      await clazz.save();

      return res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
    }

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'lesson', lid]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/lesson/:lid/register', async (req, res) => {
  try {
    const curUser = res.locals.user;
    if (!curUser) throw new ErrorMessage('请先登录。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });
    if (!curUser.nickname) throw new ErrorMessage('请先设置姓名。', { '': syzoj.utils.makeUrl(['user', curUser.id, 'edit'], { 'url': req.originalUrl }) });

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');
    await lesson.loadRelationships();

    if (!lesson.is_public && !isSupervisior) throw new ErrorMessage('课节尚未开放，请稍后再试。');

    let player = await ContestPlayer.findInContest({
      contest_id: lesson.id,
      user_id: curUser.id
    });

    if (isSupervisior || player) {
      return res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'lesson', lid]));
    }

    lesson.subtitle = await syzoj.utils.markdown(lesson.subtitle);
    lesson.reg_info = await syzoj.utils.markdown(lesson.reg_info);

    res.render('clazz_lesson_register', {
      course: course,
      clazz: clazz,
      lid: lid,
      lesson: lesson,
      reg_open: !lesson.start_time || syzoj.utils.getCurrentDate() >= lesson.start_time - 300,
      hasToken: lesson.reg_token && lesson.reg_token.trim()
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/lesson/:lid/register', async (req, res) => {
  try {
    const curUser = res.locals.user;
    if (!curUser) throw new ErrorMessage('请先登录。', { '登录': syzoj.utils.makeUrl(['login'], { 'url': req.originalUrl }) });
    if (!curUser.nickname) throw new ErrorMessage('请先设置姓名。', { '修改资料': syzoj.utils.makeUrl(['user', curUser.id, 'edit'], { 'url': req.originalUrl }) });

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');
    await lesson.loadRelationships();

    if (!lesson.is_public && !isSupervisior) throw new ErrorMessage('课节尚未开放，请稍后再试。');

    let player = await ContestPlayer.findInContest({
      contest_id: lesson.id,
      user_id: curUser.id
    });

    if (isSupervisior || player) {
      return res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'lesson', lid]));
    }

    if (lesson.reg_token && lesson.reg_token.trim()) {
      if (!req.body.token || !req.body.token.trim()) throw new ErrorMessage('请输入邀请码。');
      if (req.body.token !== lesson.reg_token) throw new ErrorMessage('邀请码错误。');
    }

    player = await ContestPlayer.create({
      contest_id: lesson.id,
      user_id: curUser.id,
      reg_time: Math.max(syzoj.utils.getCurrentDate(), lesson.type === 'usaco' && lesson.start_time ? lesson.start_time : 0)
    });
    await player.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id, 'lesson', lid]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/lesson/:lid/move_up', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    // both system administrators and course supervisior who is clazz owner can edit it.
    if (!curUser || !(await course.isSupervisior(curUser) && await clazz.hasOwnership(curUser))) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    if (lid > 1) {
      [lessonIDs[lid-2], lessonIDs[lid-1]] = [lessonIDs[lid-1], lessonIDs[lid-2]];
      clazz.lessons = lessonIDs.join('|');
      await clazz.save();
    }

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/lesson/:lid/move_down', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    // both system administrators and course supervisior who is clazz owner can edit it.
    if (!curUser || !(await course.isSupervisior(curUser) && await clazz.hasOwnership(curUser))) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    if (lid < lessonIDs.length) {
      [lessonIDs[lid-1], lessonIDs[lid]] = [lessonIDs[lid], lessonIDs[lid-1]];
      clazz.lessons = lessonIDs.join('|');
      await clazz.save();
    }

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/lesson/:lid/public', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isClassOwner = await clazz.hasOwnership(curUser);
    const isMainTeacher = isClassOwner || (curUser && curUser.id.toString() === await clazz.getMainTeacher());

    if (!isMainTeacher) throw new ErrorMessage('您没有权限进行此操作。');

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');

    lesson.is_public = true;
    await lesson.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/class/:id/lesson/:lid/delete', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    // both system administrators and course owner can edit it.
    if (!curUser || !await course.hasOwnership(curUser)) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    lessonIDs.splice(lid - 1, 1);
    clazz.lessons = lessonIDs.join('|');
    await clazz.save();

    res.redirect(syzoj.utils.makeUrl(['class', clazz.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/lesson/:lid/ranklist', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');
    await lesson.loadRelationships();

    if (!lesson.is_public && !isSupervisior) throw new ErrorMessage('课节尚未开放，请稍后再试。');

    lesson.subtitle = await syzoj.utils.markdown(lesson.subtitle);
    lesson.information = await syzoj.utils.markdown(lesson.information);

    let player = await ContestPlayer.findInContest({
      contest_id: lesson.id,
      user_id: curUser.id
    });

    if (!isSupervisior && !player) throw new ErrorMessage('请先参与作业。');

    if ([lesson.allowedSeeingResult() && lesson.allowedSeeingOthers(),
    lesson.isEnded(),
    isSupervisior].every(x => !x))
      throw new ErrorMessage('您没有权限进行此操作。');

    await lesson.loadRelationships();

    let players_id = [];
    for (let i = 1; i <= lesson.ranklist.ranklist.player_num; i++) players_id.push(lesson.ranklist.ranklist[i]);

    let ranklist = await players_id.mapAsync(async player_id => {
      let player = await ContestPlayer.findById(player_id);

      if (lesson.type === 'noi' || lesson.type === 'ioi' || lesson.type === 'usaco') {
        player.score = 0;
      }

      for (let i in player.score_details) {
        player.score_details[i].judge_state = await JudgeState.findById(player.score_details[i].judge_id);

        /*** XXX: Clumsy duplication, see ContestRanklist::updatePlayer() ***/
        if (lesson.type === 'noi' || lesson.type === 'ioi' || lesson.type === 'usaco') {
          let multiplier = (lesson.ranklist.ranking_params || {})[i] || 1.0;
          player.score_details[i].weighted_score = player.score_details[i].score == null ? null : Math.round(player.score_details[i].score * multiplier);
          player.score += player.score_details[i].weighted_score;
        }
      }

      let user = await User.findById(player.user_id);

      return {
        user: user,
        player: player
      };
    });

    let problems_id = await lesson.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    res.render('clazz_lesson_ranklist', {
      course: course,
      clazz: clazz,
      lid: lid,
      lesson: lesson,
      ranklist: ranklist,
      problems: problems
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

function getDisplayConfig(contest) {
  return {
    showScore: contest.allowedSeeingScore(),
    showUsage: contest.allowedSeeingResult(),
    showCode: false,
    showResult: contest.allowedSeeingResult(),
    showOthers: contest.allowedSeeingOthers(),
    showDetailResult: contest.allowedSeeingTestcase(),
    showTestdata: false,
    inContest: true,
    showRejudge: false
  };
}

app.get('/submissions/class/:id/lesson/:lid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');
    lesson.subtitle = await syzoj.utils.markdown(lesson.subtitle);

    if (!lesson.is_public && !isSupervisior) throw new ErrorMessage('课节尚未开放，请稍后再试。');

    let player = await ContestPlayer.findInContest({
      contest_id: lesson.id,
      user_id: curUser.id
    });

    if (!isSupervisior && !player) throw new ErrorMessage('请先参与作业。');

    const displayConfig = getDisplayConfig(lesson);
    let problems_id = await lesson.getProblems();

    let user = req.query.submitter && await User.fromName(req.query.submitter);

    let query = JudgeState.createQueryBuilder();

    let isFiltered = false;
    if (isSupervisior || lesson.isEnded()) {
      displayConfig.showOthers = true;
      displayConfig.showResult = true;
      displayConfig.showScore = true;
      displayConfig.showUsage = true;
    }
    if (displayConfig.showOthers) {
      if (user) {
        query.andWhere('user_id = :user_id', { user_id: user.id });
        isFiltered = true;
      }
    } else {
      if (curUser == null || // Not logined
        (user && user.id !== curUser.id)) { // Not querying himself
        throw new ErrorMessage("您没有权限执行此操作。");
      }
      query.andWhere('user_id = :user_id', { user_id: curUser.id });
      isFiltered = true;
    }

    if (displayConfig.showScore) {
      let minScore = parseInt(req.body.min_score);
      if (!isNaN(minScore)) query.andWhere('score >= :minScore', { minScore });
      let maxScore = parseInt(req.body.max_score);
      if (!isNaN(maxScore)) query.andWhere('score <= :maxScore', { maxScore });

      if (!isNaN(minScore) || !isNaN(maxScore)) isFiltered = true;
    }

    if (req.query.language) {
      if (req.body.language === 'submit-answer') {
        query.andWhere(new TypeORM.Brackets(qb => {
          qb.orWhere('language = :language', { language: '' })
            .orWhere('language IS NULL');
        }));
      } else if (req.body.language === 'non-submit-answer') {
        query.andWhere('language != :language', { language: '' })
             .andWhere('language IS NOT NULL');
      } else {
        query.andWhere('language = :language', { language: req.body.language })
      }
      isFiltered = true;
    }

    if (displayConfig.showResult) {
      if (req.query.status) {
        query.andWhere('status = :status', { status: req.query.status });
        isFiltered = true;
      }
    }

    if (req.query.problem_id) {
      problem_id = problems_id[parseInt(req.query.problem_id) - 1] || 0;
      query.andWhere('problem_id = :problem_id', { problem_id })
      isFiltered = true;
    }

    query.andWhere('type = 3')
         .andWhere('type_info = :lesson_id', { lesson_id: lesson.id });

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
      obj.problem_id = problems_id.indexOf(obj.problem_id) + 1;
      obj.problem.title = syzoj.utils.removeTitleTag(obj.problem.title);
    });

    const pushType = displayConfig.showResult ? 'rough' : 'compile';
    res.render('submissions', {
      course: course,
      clazz: clazz,
      lid: lid,
      lesson: lesson,
      items: judge_state.map(x => ({
        info: getSubmissionInfo(x, displayConfig),
        token: (getRoughResult(x, displayConfig) == null && x.task_id != null) ? jwt.sign({
          taskId: x.task_id,
          type: pushType,
          displayConfig: displayConfig
        }, syzoj.config.session_secret) : null,
        result: getRoughResult(x, displayConfig),
        running: false,
      })),
      paginate: paginate,
      form: req.query,
      displayConfig: displayConfig,
      pushType: pushType,
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

app.get('/class/:id/lesson/:lid/submission/:sid', async (req, res) => {
  try {
    const id = parseInt(req.params.sid);
    const judge = await JudgeState.findById(id);
    if (!judge) throw new ErrorMessage("提交记录 ID 不正确。");
    if (judge.type !== 3) return res.redirect(syzoj.utils.makeUrl(['submission', id]));

    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    const isClassOwner = await clazz.hasOwnership(curUser);
    const isMainTeacher = isClassOwner || (curUser && curUser.id.toString() === await clazz.getMainTeacher());

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');
    lesson.ended = lesson.isEnded();

    if (!lesson.is_public && !isSupervisior) throw new ErrorMessage('课节尚未开放，请稍后再试。');

    if (judge.type_info !== lesson.id) throw new ErrorMessage("提交记录 ID 不正确。");

    if (!isSupervisior && judge.user_id !== curUser.id) throw new ErrorMessage("您没有权限执行此操作。");

    const displayConfig = getDisplayConfig(lesson);
    displayConfig.showCode = true;
    if (isMainTeacher || lesson.isEnded()) {
      displayConfig.showResult = true;
      displayConfig.showDetailResult = true;
      displayConfig.showScore = true;
      displayConfig.showUsage = true;
    }
    if (isMainTeacher) {
      displayConfig.showTestdata = true;
      displayConfig.showRejudge = true;
    }

    await judge.loadRelationships();
    const problems_id = await lesson.getProblems();
    judge.problem_id = problems_id.indexOf(judge.problem_id) + 1;
    judge.problem.title = syzoj.utils.removeTitleTag(judge.problem.title);

    if (judge.problem.type !== 'submit-answer') {
      judge.codeLength = Buffer.from(judge.code).length;
      judge.code = await syzoj.utils.highlight(judge.code, syzoj.languages[judge.language].highlight);
    }

    res.render('submission', {
      info: getSubmissionInfo(judge, displayConfig),
      roughResult: getRoughResult(judge, displayConfig),
      code: (displayConfig.showCode && judge.problem.type !== 'submit-answer') ? judge.code.toString("utf8") : '',
      formattedCode: judge.formattedCode ? judge.formattedCode.toString("utf8") : null,
      preferFormattedCode: res.locals.user ? res.locals.user.prefer_formatted_code : false,
      detailResult: processOverallResult(judge.result, displayConfig),
      socketToken: (displayConfig.showDetailResult && judge.pending && judge.task_id != null) ? jwt.sign({
        taskId: judge.task_id,
        displayConfig: displayConfig,
        type: 'detail'
      }, syzoj.config.session_secret) : null,
      displayConfig: displayConfig,
      course: course,
      clazz: clazz,
      lid: lid,
      lesson: lesson,
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/class/:id/lesson/:lid/problem/:pid', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');
    await lesson.loadRelationships();

    if (!lesson.is_public && !isSupervisior) throw new ErrorMessage('课节尚未开放，请稍后再试。');

    lesson.subtitle = await syzoj.utils.markdown(lesson.subtitle);
    lesson.information = await syzoj.utils.markdown(lesson.information);

    let player = await ContestPlayer.findInContest({
      contest_id: lesson.id,
      user_id: curUser.id
    });

    if (!isSupervisior && !player) throw new ErrorMessage('请先参与作业。');

    lesson.ended = (lesson.isEnded() || (lesson.type === 'usaco' && !isSupervisior && syzoj.utils.getCurrentDate() >= player.reg_time + lesson.duration));
    if (!isSupervisior && !(lesson.isRunning() || lesson.isEnded())) {
      throw new ErrorMessage('课节尚未开始。');
    }

    let problems_id = await lesson.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.findById(problem_id);
    await problem.loadRelationships();

    problem.specialJudge = await problem.hasSpecialJudge();

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let state = await problem.getJudgeState(res.locals.user, false, 3, lesson.id);
    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    await problem.loadRelationships();

    res.render('course_problem', {
      course: course,
      clazz: clazz,
      lid: lid,
      lesson: lesson,
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

app.get('/class/:id/lesson/:lid/:pid/download/additional_file', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let classID = parseInt(req.params.id);
    let clazz = await Clazz.findById(classID);
    if (!clazz) throw new ErrorMessage('无此班级。');

    let course = await Course.findById(clazz.course_id);
    if (!course) throw new ErrorMessage('错误的课程。');

    const isSupervisior = await clazz.isSupervisior(curUser);

    if (!isSupervisior) {
      if (!curUser || !await clazz.isStudent(curUser)) {
        throw new ErrorMessage('仅对班级学员开放，请先完成报名。');
      }
      if (!clazz.is_public) throw new ErrorMessage('班级主页维护中，请稍后再试。');
    }

    let lessonIDs = await clazz.getLessons();

    let lid = parseInt(req.params.lid);
    if (lid < 1 || lid > lessonIDs.length) throw new ErrorMessage('无此课节。');

    let lessonID = lessonIDs[lid - 1];
    let lesson = await Contest.findById(lessonID);
    if (!lesson) throw new ErrorMessage('无此课节。');
    await lesson.loadRelationships();

    if (!lesson.is_public && !isSupervisior) throw new ErrorMessage('课节尚未开放，请稍后再试。');

    lesson.subtitle = await syzoj.utils.markdown(lesson.subtitle);
    lesson.information = await syzoj.utils.markdown(lesson.information);

    let player = await ContestPlayer.findInContest({
      contest_id: lesson.id,
      user_id: curUser.id
    });

    if (!isSupervisior && !player) throw new ErrorMessage('请先参与作业。');

    lesson.ended = (lesson.isEnded() || (lesson.type === 'usaco' && !isSupervisior && syzoj.utils.getCurrentDate() >= player.reg_time + lesson.duration));
    if (!isSupervisior && !(lesson.isRunning() || lesson.isEnded())) {
      throw new ErrorMessage('课节尚未开始。');
    }

    let problems_id = await lesson.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.findById(problem_id);

    await problem.loadRelationships();

    if (!problem.additional_file) throw new ErrorMessage('无附加文件。');

    res.download(problem.additional_file.getPath(), `additional_file_${classID}_${lid}_${pid}.zip`);
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});
