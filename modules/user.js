let User = syzoj.model('user');
const Resume = syzoj.model('resume');
const RatingCalculation = syzoj.model('rating_calculation');
const RatingHistory = syzoj.model('rating_history');
const Contest = syzoj.model('contest');
const ContestPlayer = syzoj.model('contest_player');
const Clazz = syzoj.model('clazz');
const ClazzStudent = syzoj.model('clazz_student');

const fs = require('fs-extra');

// Ranklist
app.get('/ranklist', async (req, res) => {
  try {
    const sort = req.query.sort || syzoj.config.sorting.ranklist.field;
    const order = req.query.order || syzoj.config.sorting.ranklist.order;
    if (!['ac_num', 'rating', 'id', 'username'].includes(sort) || !['asc', 'desc'].includes(order)) {
      throw new ErrorMessage('错误的排序参数。');
    }
    let paginate = syzoj.utils.paginate(await User.countForPagination({ is_show: true }), req.query.page, syzoj.config.page.ranklist);
    let ranklist = await User.queryPage(paginate, { is_show: true }, { [sort]: order.toUpperCase() });
    await ranklist.forEachAsync(async x => x.renderInformation());

    res.render('ranklist', {
      ranklist: ranklist,
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

app.get('/find_user', async (req, res) => {
  try {
    let user = await User.fromName(req.query.nickname);
    if (!user) throw new ErrorMessage('无此用户。');
    res.redirect(syzoj.utils.makeUrl(['user', user.id]));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

// Login
app.get('/login', async (req, res) => {
  if (res.locals.user) {
    res.render('error', {
      err: new ErrorMessage('您已经登录了，请先注销。', { '注销': syzoj.utils.makeUrl(['logout'], { 'url': req.originalUrl }) })
    });
  } else {
    res.render('login');
  }
});

// Sign up
app.get('/sign_up', async (req, res) => {
  if (res.locals.user) {
    res.render('error', {
      err: new ErrorMessage('您已经登录了，请先注销。', { '注销': syzoj.utils.makeUrl(['logout'], { 'url': req.originalUrl }) })
    });
  } else {
    res.render('sign_up');
  }
});

// Logout
app.post('/logout', async (req, res) => {
  req.session.user_id = null;
  res.clearCookie('login');
  res.redirect(req.query.url || '/');
});

// User page
app.get('/user/:id', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');
    user.ac_problems = await user.getACProblems();
    user.articles = await user.getArticles();
    user.allowedEdit = await user.isAllowedEditBy(res.locals.user);

    let statistics = await user.getStatistics();
    await user.renderInformation();
    user.emailVisible = user.public_email || user.allowedEdit;

    const ratingHistoryValues = await RatingHistory.find({
      where: { user_id: user.id },
      order: { rating_calculation_id: 'ASC' }
    });
    const ratingHistories = [{
      contestName: "初始积分",
      value: syzoj.config.default.user.rating,
      delta: null,
      rank: null
    }];

    for (const history of ratingHistoryValues) {
      const contest = await Contest.findById((await RatingCalculation.findById(history.rating_calculation_id)).contest_id);
      ratingHistories.push({
        contestName: contest.title,
        value: history.rating_after,
        delta: history.rating_after - ratingHistories[ratingHistories.length - 1].value,
        rank: history.rank,
        participants: await ContestPlayer.count({ contest_id: contest.id })
      });
    }
    ratingHistories.reverse();

    res.render('user', {
      show_user: user,
      statistics: statistics,
      ratingHistories: ratingHistories
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/user/:id/edit', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    user.privileges = await user.getPrivileges();

    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    res.render('user_edit', {
      edited_user: user,
      error_info: null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/forget', async (req, res) => {
  res.render('forget');
});



app.post('/user/:id/edit', async (req, res) => {
  let user;
  try {
    let id = parseInt(req.params.id);
    user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) throw new ErrorMessage('您没有权限进行此操作。');

    if (req.body.old_password && req.body.new_password) {
      if (user.password !== req.body.old_password && !await res.locals.user.hasPrivilege('manage_user')) throw new ErrorMessage('旧密码错误。');
      user.password = req.body.new_password;
    }

    if (res.locals.user && await res.locals.user.hasPrivilege('manage_user')) {
      if (!syzoj.utils.isValidUsername(req.body.username)) throw new ErrorMessage('无效的用户名。');
      user.username = req.body.username;
      user.email = req.body.email;
      user.nameplate = req.body.nameplate;
    }

    if (res.locals.user && res.locals.user.is_admin) {
      if (!req.body.privileges) {
        req.body.privileges = [];
      } else if (!Array.isArray(req.body.privileges)) {
        req.body.privileges = [req.body.privileges];
      }

      let privileges = req.body.privileges;
      await user.setPrivileges(privileges);
    }

    user.nickname = req.body.nickname;
    user.information = req.body.information;
    user.sex = req.body.sex;
    user.public_email = (req.body.public_email === 'on');
    user.prefer_formatted_code = (req.body.prefer_formatted_code === 'on');

    await user.save();

    if (user.id === res.locals.user.id) res.locals.user = user;

    user.privileges = await user.getPrivileges();
    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    res.render('user_edit', {
      edited_user: user,
      error_info: ''
    });
  } catch (e) {
    try {
      user.privileges = await user.getPrivileges();
      if (res.locals.user)
        res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');
    } catch (e) {
      console.error(e);
    }

    res.render('user_edit', {
      edited_user: user,
      error_info: e.message
    });
  }
});

app.get('/user/:id/resume', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    let user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) {
      throw new ErrorMessage('您没有权限进行此操作。');
    }

    user.privileges = await user.getPrivileges();

    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    let resume = await Resume.findById(id);

    if (!resume) {
      resume = await Resume.create();
      resume.id = id;
      resume.graduation_year = 0;
    }
    resume.grade = resume.graduation_year;

    let resume_file = await resume.loadResumeFile();

    res.render('resume_edit', {
      edited_user: user,
      resume: resume,
      resume_file: resume_file,
      class_id: parseInt(req.query.class),
      error_info: null
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.post('/user/:id/resume', app.multer.fields([{ name: 'resume_file', maxCount: 1 }]), async (req, res) => {
  let user;
  let resume;
  let resume_file;
  try {
    let id = parseInt(req.params.id);
    user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) throw new ErrorMessage('您没有权限进行此操作。');

    resume = await Resume.findById(id);
    if (!resume) {
      resume = await Resume.create();
      resume.id = id;
    }

    if (!req.body.name.trim()) throw new ErrorMessage('姓名不能为空。');
    resume.name = req.body.name;
    if (!req.body.school.trim()) throw new ErrorMessage('学校不能为空。');
    resume.school = req.body.school;
    resume.graduation_year = req.body.grade;
    resume.grade = resume.graduation_year;

    if (!req.body.contact.trim()) throw new ErrorMessage('联系人姓名不能为空。');
    resume.contact = req.body.contact;
    if (!req.body.phone_number.trim()) throw new ErrorMessage('联系人电话不能为空。');
    resume.phone_number = req.body.phone_number;
    resume.relationship = req.body.relationship;

    resume.score = (req.body.score || 0);
    resume.award1 = req.body.award1;
    resume.award2 = req.body.award2;
    resume.award3 = req.body.award3;
    resume.award4 = req.body.award4;

    await resume.save();

    if (req.files['resume_file']){
      let file = req.files['resume_file'][0];
      if (file.mimetype !== 'application/pdf') throw new ErrorMessage('请上传 PDF 类型的文件。');
      if (file.size > 2097152) throw new ErrorMessage('简历文件太大。');
      await resume.updateResumeFile(file.path);
      resume_file = await resume.loadResumeFile();
    }

    if (user.id === res.locals.user.id) res.locals.user = user;

    user.privileges = await user.getPrivileges();
    res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');

    res.render('resume_edit', {
      edited_user: user,
      resume: resume,
      resume_file: resume_file,
      class_id: parseInt(req.query.class),
      error_info: ''
    });
  } catch (e) {
    try {
      user.privileges = await user.getPrivileges();
      if (res.locals.user)
        res.locals.user.allowedManage = await res.locals.user.hasPrivilege('manage_user');
    } catch (e) {
      console.error(e);
    }

    res.render('resume_edit', {
      edited_user: user,
      resume: resume,
      resume_file: resume_file,
      class_id: parseInt(req.query.class),
      error_info: e.message
    });
  }
});

app.get('/user/:id/resume_file', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let classID = parseInt(req.query.class);
    if (classID) {
      let clazz = await Clazz.findById(classID);
      if (!clazz) throw new ErrorMessage('无此班级。');
      if (!await clazz.hasOwnership(res.locals.user)) throw new ErrorMessage('您没有权限进行此操作。');
      if (!await ClazzStudent.findInClazz({
        class_id: classID,
        user_id: user.id
      })) throw new ErrorMessage('非班级学员。');
    } else {
      let allowedEdit = await user.isAllowedEditBy(res.locals.user);
      if (!allowedEdit) throw new ErrorMessage('您没有权限进行此操作。');
    }

    let resume = await Resume.findById(id);
    if (!resume) throw new ErrorMessage('简历文件不存在。');
    let resume_file = await resume.loadResumeFile();
    if (!resume_file) throw new ErrorMessage('简历文件不存在。');

    res.contentType("application/pdf");
    fs.createReadStream(resume.getResumeFilePath()).pipe(res);
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});

app.post('/user/:id/delete/resume_file', async (req, res) => {
  try {
    let id = parseInt(req.params.id);
    user = await User.findById(id);
    if (!user) throw new ErrorMessage('无此用户。');

    let allowedEdit = await user.isAllowedEditBy(res.locals.user);
    if (!allowedEdit) throw new ErrorMessage('您没有权限进行此操作。');
    
    let resume = await Resume.findById(id);
    if (!resume) throw new ErrorMessage('简历文件不存在。');

    await resume.deleteResumeFile();

    let classID = parseInt(req.query.class);
    res.redirect(syzoj.utils.makeUrl(['user', id, 'resume'], classID ? { class : classID } : {}));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
