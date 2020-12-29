let Course = syzoj.model('course');
let Contest = syzoj.model('contest');
let ContestPlayer = syzoj.model('contest_player');
let Problem = syzoj.model('problem');
let JudgeState = syzoj.model('judge_state');
let User = syzoj.model('user');

const jwt = require('jsonwebtoken');
const { getSubmissionInfo, getRoughResult, processOverallResult } = require('../libs/submissions_process');

app.get('/courses', async (req, res) => {
  try {
    let where;
    if (res.locals.user && res.locals.user.is_admin) where = {}
    else where = { is_public: true };

    let paginate = syzoj.utils.paginate(await Course.countForPagination(where), req.query.page, syzoj.config.page.course);
    let courses = await Course.queryPage(paginate, where, {
      start_time: 'DESC'
    });

    await courses.forEachAsync(async x => x.subtitle = await syzoj.utils.markdown(x.subtitle));

    res.render('courses', {
      courses: courses,
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

    let course_id = parseInt(req.params.id);
    let course = await Course.findById(course_id);
    if (!course) {
      // if cuorse does not exist, only system administrators can create one
      if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

      course = await Course.create();
      course.id = 0;
    } else {
      // if course exists, both system administrators and contest administrators can edit it.
      if (!res.locals.user || (!res.locals.user.is_admin && !contest.admins.includes(res.locals.user.id.toString()))) throw new ErrorMessage('您没有权限进行此操作。');

      await course.loadRelationships();
    }

    let contests = [], admins = [], participants = [];
    if (course.contests) contests = await course.contests.split('|').mapAsync(async id => await Contest.findById(id));
    if (course.admins) admins = await course.admins.split('|').mapAsync(async id => await User.findById(id));
    if (course.participants) participants = await course.participants.split('|').mapAsync(async id => await User.findById(id));

    res.render('course_edit', {
      course: course,
      contests: contests,
      admins: admins,
      participants: participants
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

    let course_id = parseInt(req.params.id);
    let course = await Course.findById(course_id);
    if (!course) {
      // if course does not exist, only system administrators can create one
      if (!res.locals.user || !res.locals.user.is_admin) throw new ErrorMessage('您没有权限进行此操作。');

      course = await Course.create();

      course.holder_id = res.locals.user.id;
    } else {
      // if course exists, both system administrators and course administrators can edit it.
      if (!res.locals.user || (!res.locals.user.is_admin && !course.admins.includes(res.locals.user.id.toString()))) throw new ErrorMessage('您没有权限进行此操作。');
      
      await course.loadRelationships();
    }

    if (!req.body.title.trim()) throw new ErrorMessage('课程名不能为空。');
    course.title = req.body.title;
    course.subtitle = req.body.subtitle;
    if (!Array.isArray(req.body.contests)) req.body.contests = [req.body.contests];
    if (!Array.isArray(req.body.admins)) req.body.admins = [req.body.admins];
    if (!Array.isArray(req.body.participants)) req.body.admins = [req.body.participants];
    course.contests = req.body.contests.join('|');
    course.admins = req.body.admins.join('|');
    course.participants = req.body.participants.join('|');
    course.information = req.body.information;
    course.start_time = syzoj.utils.parseDate(req.body.start_time);
    course.end_time = syzoj.utils.parseDate(req.body.end_time);
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
    let course_id = parseInt(req.params.id);

    let course = await Course.findById(course_id);
    if (!course) throw new ErrorMessage('无此课程。');

    const isSupervisior = await course.isSupervisior(curUser);

    if (!res.locals.user) throw new ErrorMessage('请先登录');
    if (!res.locals.user.is_admin && !course.admins.includes(res.locals.user.id.toString())) {
      // if course is non-public, both system administrators and course administrators can see it.
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
      if (!course.participants.includes(res.locals.user.id.toString())) throw new ErrorMessage('您尚未选课');
    }

    course.running = course.isRunning();
    course.ended = course.isEnded();
    course.subtitle = await syzoj.utils.markdown(course.subtitle);
    course.information = await syzoj.utils.markdown(course.information);

    let contests_id = await course.getContests();
    let contests = await contests_id.mapAsync(async id => await Contest.findById(id));

    contests = contests.map(x => ({ contest: x, statistics: null }));
    for (let contest of contests) {
      let player = null;

      if (res.locals.user) {
        player = await ContestPlayer.findInContest({
          contest_id: contest.contest.id,
          user_id: res.locals.user.id
        });
      }

      contest.statistics = { ac_num: 0, problem_num: 0 };
      let problems_id = await contest.contest.getProblems();
      contest.statistics.problem_num = problems_id.length;
      if (player) {
        for (let problem_id of problems_id) {
          if (player.score_details[problem_id] && player.score_details[problem_id].accepted) {
            ++contest.statistics.ac_num;
          }
        }
      }
    }

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

app.get('/course/:id/contest/:cid', async (req, res) => {
  try {
    let course_id = parseInt(req.params.id);
    let course = await Course.findById(course_id);
    if (!course) throw new ErrorMessage('无此课程。');
    const curUser = res.locals.user;

    if (!res.locals.user) throw new ErrorMessage('请先登录');
    if (!res.locals.user.is_admin && !course.admins.includes(res.locals.user.id.toString())) {
      // if course is non-public, both system administrators and course administrators can see it.
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
      if (!course.participants.includes(res.locals.user.id.toString())) throw new ErrorMessage('您尚未选课');
    }

    let contests_id = await course.getContests();

    let cid = parseInt(req.params.cid);
    if (!cid || cid < 1 || cid > contests_id.length) throw new ErrorMessage('无此课节。');

    let contest_id = contests_id[cid - 1];
    let contest = await Contest.findById(contest_id);
    await contest.loadRelationships();

    const isSupervisior = await course.isSupervisior(curUser);

    if (!isSupervisior && !(contest.isRunning() || contest.isEnded())) {
      throw new ErrorMessage('课节尚未开始。');
    }

    contest.running = contest.isRunning();
    contest.ended = contest.isEnded();
    contest.subtitle = await syzoj.utils.markdown(contest.subtitle);
    contest.information = await syzoj.utils.markdown(contest.information);

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    let player = null;

    if (res.locals.user) {
      player = await ContestPlayer.findInContest({
        contest_id: contest.id,
        user_id: res.locals.user.id
      });
    }

    problems = problems.map(x => ({ problem: x, status: null, judge_id: null, statistics: null }));
    if (player) {
      for (let problem of problems) {
        problem.problem.specialJudge = await problem.problem.hasSpecialJudge();
        if (contest.type === 'noi') {
          if (player.score_details[problem.problem.id]) {
            let judge_state = await JudgeState.findById(player.score_details[problem.problem.id].judge_id);
            problem.status = judge_state.status;
            if (!contest.ended && !await problem.problem.isAllowedEditBy(res.locals.user) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
              problem.status = 'Submitted';
            }
            problem.judge_id = player.score_details[problem.problem.id].judge_id;
            if (contest.ended) {
              await contest.loadRelationships();
              let multiplier = contest.ranklist.ranking_params[problem.problem.id] || 1.0;
              problem.feedback = (judge_state.score * multiplier).toString() + ' / ' + (100 * multiplier).toString();
            }
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

    res.render('contest', {
      cid, cid,
      course: course,
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

app.get('/course/:id/contest/:cid/ranklist', async (req, res) => {
  try {
    let course_id = parseInt(req.params.id);
    let course = await Course.findById(course_id);
    if (!course) throw new ErrorMessage('无此课程。');
    const curUser = res.locals.user;

    if (!res.locals.user) throw new ErrorMessage('请先登录');
    if (!res.locals.user.is_admin && !course.admins.includes(res.locals.user.id.toString())) {
      // if course is non-public, both system administrators and course administrators can see it.
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
      if (!course.participants.includes(res.locals.user.id.toString())) throw new ErrorMessage('您尚未选课');
    }

    let contests_id = await course.getContests();

    let cid = parseInt(req.params.cid);
    if (!cid || cid < 1 || cid > contests_id.length) throw new ErrorMessage('无此课节。');

    let contest_id = contests_id[cid - 1];
    let contest = await Contest.findById(contest_id);

    if (!contest) throw new ErrorMessage('无此课节。');

    if ([contest.allowedSeeingResult() && contest.allowedSeeingOthers(),
    contest.isEnded(),
    await contest.isSupervisior(curUser)].every(x => !x))
      throw new ErrorMessage('您没有权限进行此操作。');

    await contest.loadRelationships();

    let players_id = [];
    for (let i = 1; i <= contest.ranklist.ranklist.player_num; i++) players_id.push(contest.ranklist.ranklist[i]);

    let ranklist = await players_id.mapAsync(async player_id => {
      let player = await ContestPlayer.findById(player_id);

      if (contest.type === 'noi' || contest.type === 'ioi') {
        player.score = 0;
      }

      for (let i in player.score_details) {
        player.score_details[i].judge_state = await JudgeState.findById(player.score_details[i].judge_id);

        /*** XXX: Clumsy duplication, see ContestRanklist::updatePlayer() ***/
        if (contest.type === 'noi' || contest.type === 'ioi') {
          let multiplier = (contest.ranklist.ranking_params || {})[i] || 1.0;
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

    let problems_id = await contest.getProblems();
    let problems = await problems_id.mapAsync(async id => await Problem.findById(id));

    res.render('contest_ranklist', {
      cid: cid,
      course: course,
      contest: contest,
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
    showUsage: false,
    showCode: true,
    showResult: contest.allowedSeeingResult(),
    showOthers: contest.allowedSeeingOthers(),
    showDetailResult: contest.allowedSeeingTestcase(),
    showTestdata: false,
    inContest: true,
    showRejudge: false
  };
}

app.get('/course/:id/contest/:cid/submissions', async (req, res) => {
  try {
    let course_id = parseInt(req.params.id);
    let course = await Course.findById(course_id);
    if (!course) throw new ErrorMessage('无此课程。');
    const curUser = res.locals.user;

    if (!res.locals.user) throw new ErrorMessage('请先登录');
    if (!res.locals.user.is_admin && !course.admins.includes(res.locals.user.id.toString())) {
      // if course is non-public, both system administrators and course administrators can see it.
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
      if (!course.participants.includes(res.locals.user.id.toString())) throw new ErrorMessage('您尚未选课');
    }

    let contests_id = await course.getContests();

    let cid = parseInt(req.params.cid);
    if (!cid || cid < 1 || cid > contests_id.length) throw new ErrorMessage('无此课节。');

    let contest_id = contests_id[cid - 1];
    let contest = await Contest.findById(contest_id);

    if (contest.isEnded()) {
      res.redirect(syzoj.utils.makeUrl(['submissions'], { course: course_id, cid: cid }));
      return;
    }

    const displayConfig = getDisplayConfig(contest);
    let problems_id = await contest.getProblems();

    let user = req.query.submitter && await User.fromName(req.query.submitter);

    let query = JudgeState.createQueryBuilder();

    let isFiltered = false;
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

    query.andWhere('type = 2')
         .andWhere('type_info = :type_info', { type_info: course_id * 1000 + cid });

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
      cid: cid,
      course, course,
      contest: contest,
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


app.get('/course/contest/submission/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const judge = await JudgeState.findById(id);
    if (!judge) throw new ErrorMessage("提交记录 ID 不正确。");
    const curUser = res.locals.user;
    if ((!curUser) || judge.user_id !== curUser.id) throw new ErrorMessage("您没有权限执行此操作。");

    if (judge.type !== 2) {
      return res.redirect(syzoj.utils.makeUrl(['submission', id]));
    }

    let course_id = parseInt(judge.type_info / 1000);
    let course = await Course.findById(course_id);
    if (!course) throw new ErrorMessage('无此课程。');

    if (!res.locals.user) throw new ErrorMessage('请先登录');
    if (!res.locals.user.is_admin && !course.admins.includes(res.locals.user.id.toString())) {
      // if course is non-public, both system administrators and course administrators can see it.
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
      if (!course.participants.includes(res.locals.user.id.toString())) throw new ErrorMessage('您尚未选课');
    }

    let contests_id = await course.getContests();

    let cid = judge.type_info % 1000;
    if (!cid || cid < 1 || cid > contests_id.length) throw new ErrorMessage('无此课节。');

    let contest_id = contests_id[cid - 1];
    const contest = await Contest.findById(contest_id);
    contest.ended = contest.isEnded();

    const displayConfig = getDisplayConfig(contest);
    displayConfig.showCode = true;

    await judge.loadRelationships();
    const problems_id = await contest.getProblems();
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
      cid: cid,
      course: course,
      contest: contest,
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/course/:id/contest/:cid/problem/:pid', async (req, res) => {
  try {
    let course_id = parseInt(req.params.id);
    let course = await Course.findById(course_id);
    if (!course) throw new ErrorMessage('无此课程。');
    const curUser = res.locals.user;

    if (!res.locals.user) throw new ErrorMessage('请先登录');
    if (!res.locals.user.is_admin && !course.admins.includes(res.locals.user.id.toString())) {
      // if course is non-public, both system administrators and course administrators can see it.
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
      if (!course.participants.includes(res.locals.user.id.toString())) throw new ErrorMessage('您尚未选课');
    }

    let contests_id = await course.getContests();

    let cid = parseInt(req.params.cid);
    if (!cid || cid < 1 || cid > contests_id.length) throw new ErrorMessage('无此课节。');

    let contest_id = contests_id[cid - 1];
    let contest = await Contest.findById(contest_id);
    if (!contest) throw new ErrorMessage('无此课节。');

    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.findById(problem_id);
    await problem.loadRelationships();

    contest.ended = contest.isEnded();
    if (!await contest.isSupervisior(curUser) && !(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id]));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }

    problem.state = await problem.getJudgeState(res.locals.user, true);
    problem.specialJudge = await problem.hasSpecialJudge();

    await syzoj.utils.markdown(problem, ['description', 'input_format', 'output_format', 'example', 'limit_and_hint']);

    let testcases = await syzoj.utils.parseTestdata(problem.getTestdataPath(), problem.type === 'submit-answer');

    let player = null;

    if (res.locals.user) {
      player = await ContestPlayer.findInContest({
        contest_id: contest.id,
        user_id: res.locals.user.id
      });
    }

    await problem.loadRelationships();

    problem.status = null;
    problem.judge_id = null;
    if (player) {
      if (contest.type === 'noi') {
        if (player.score_details[problem.id]) {
          let judge_state = await JudgeState.findById(player.score_details[problem.id].judge_id);
          problem.status = judge_state.status;
          if (!contest.ended && !await problem.isAllowedEditBy(res.locals.user) && !['Compile Error', 'Waiting', 'Compiling'].includes(problem.status)) {
            problem.status = 'Submitted';
          }
          problem.judge_id = player.score_details[problem.id].judge_id;
        }
      } else if (contest.type === 'ioi') {
        if (player.score_details[problem.id]) {
          let judge_state = await JudgeState.findById(player.score_details[problem.id].judge_id);
          problem.status = judge_state.status;
          problem.judge_id = player.score_details[problem.id].judge_id;
          await contest.loadRelationships();
          let multiplier = contest.ranklist.ranking_params[problem.id] || 1.0;
          problem.feedback = (judge_state.score * multiplier).toString() + ' / ' + (100 * multiplier).toString();
        }
      } else if (contest.type === 'acm') {
        if (player.score_details[problem.id]) {
          problem.status = {
            accepted: player.score_details[problem.id].accepted,
            unacceptedCount: player.score_details[problem.id].unacceptedCount
          };
          problem.judge_id = player.score_details[problem.id].judge_id;
        } else {
          problem.status = null;
        }
      }
    }

    let hasStatistics = false;
    if ((!contest.hide_statistics) || (contest.ended) || (await contest.isSupervisior(curUser))) {
      hasStatistics = true;

      await contest.loadRelationships();
      let players = await contest.ranklist.getPlayers();
      problem.statistics = { attempt: 0, accepted: 0 };

      for (let player of players) {
        if (player.score_details[problem.id]) {
          problem.statistics.attempt++;
          if ((contest.type === 'acm' && player.score_details[problem.id].accepted) || ((contest.type === 'noi' || contest.type === 'ioi') && player.score_details[problem.id].score === 100)) {
            problem.statistics.accepted++;
          }
        }
      }
    }

    res.render('problem', {
      cid: cid,
      pid: pid,
      course, course,
      contest: contest,
      problem: problem,
      hasStatistics: hasStatistics,
      lastState: await problem.getJudgeState(res.locals.user, false),
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

app.get('/course/:id/contest/:cid/:pid/download/additional_file', async (req, res) => {
  try {
    let course_id = parseInt(req.params.id);
    let course = await Course.findById(course_id);
    if (!course) throw new ErrorMessage('无此课程。');

    if (!res.locals.user) throw new ErrorMessage('请先登录');
    if (!res.locals.user.is_admin && !course.admins.includes(res.locals.user.id.toString())) {
      // if course is non-public, both system administrators and course administrators can see it.
      if (!course.is_public) throw new ErrorMessage('课程未公开，请耐心等待 (´∀ `)');
      if (!course.participants.includes(res.locals.user.id.toString())) throw new ErrorMessage('您尚未选课');
    }

    let contests_id = await course.getContests();

    let cid = parseInt(req.params.cid);
    if (!cid || cid < 1 || cid > contests_id.length) throw new ErrorMessage('无此课节。');

    let contest_id = contests_id[cid - 1];
    let contest = await Contest.findById(contest_id);
    if (!contest) throw new ErrorMessage('无此课节。');

    let problems_id = await contest.getProblems();

    let pid = parseInt(req.params.pid);
    if (!pid || pid < 1 || pid > problems_id.length) throw new ErrorMessage('无此题目。');

    let problem_id = problems_id[pid - 1];
    let problem = await Problem.findById(problem_id);

    contest.ended = contest.isEnded();
    if (!(contest.isRunning() || contest.isEnded())) {
      if (await problem.isAllowedUseBy(res.locals.user)) {
        return res.redirect(syzoj.utils.makeUrl(['problem', problem_id, 'download', 'additional_file']));
      }
      throw new ErrorMessage('比赛尚未开始。');
    }

    await problem.loadRelationships();

    if (!problem.additional_file) throw new ErrorMessage('无附加文件。');

    res.download(problem.additional_file.getPath(), `additional_file_${id}_${pid}.zip`);
  } catch (e) {
    syzoj.log(e);
    res.status(404);
    res.render('error', {
      err: e
    });
  }
});
