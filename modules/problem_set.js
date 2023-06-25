let ProblemSet = syzoj.model('problem_set');
let User = syzoj.model('user');

app.get('/problems/set/:id/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let setID = parseInt(req.params.id);
    let set = await ProblemSet.findById(setID);

    if (!set) {
      // if problem set does not exist, only system administrators can create one
      if (!curUser || !curUser.is_admin) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      set = await ProblemSet.create();
      set.id = 0;
    } else {
      // if problem set exists, both system administrators and problem set owner can edit it.
      if (!curUser || !await set.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await set.loadRelationships();
    }

    let owner = curUser;
    if (set.owner_id) owner = await User.findById(set.owner_id);
    let admins = [];
    if (set.admins) {
      admins = await set.admins.split('|').mapAsync(async id => await User.findById(id));
    }

    res.render('problem_set_edit', {
      set: set,
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

app.post('/problems/set/:id/edit', async (req, res) => {
  try {
    const curUser = res.locals.user;

    let setID = parseInt(req.params.id);
    let set = await ProblemSet.findById(setID);

    if (!set) {
      // if problem set does not exist, only system administrators can create one
      if (!curUser || !curUser.is_admin) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      set = await ProblemSet.create();
    } else {
      // if problem set exists, both system administrators and problem set owner can edit it.
      if (!curUser || !await set.hasOwnership(curUser)) {
        throw new ErrorMessage('您没有权限进行此操作。');
      }
      await set.loadRelationships();
    }

    if (!req.body.title.trim()) throw new ErrorMessage('题单名不能为空。');
    set.title = req.body.title;
    set.subtitle = req.body.subtitle;
    // only system administrators can set set owner and admins and set public
    if (curUser.is_admin) {
      set.owner_id = parseInt(req.body.owner);
      if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
      set.admins = req.body.admins.join('|');
      set.is_public = (req.body.is_public === 'on');
    }

    await set.save();

    res.redirect(syzoj.utils.makeUrl(['problems'], { set: set.id }));
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
