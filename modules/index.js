let User = syzoj.model('user');
let Article = syzoj.model('article');
let Contest = syzoj.model('contest');
let Problem = syzoj.model('problem');
let TimeAgo = require('javascript-time-ago');
let zh = require('../libs/timeago');
TimeAgo.locale(zh);
const timeAgo = new TimeAgo('zh-CN');

app.get('/', async (req, res) => {
  try {
    let notices = (await Article.find({
      where: { is_notice: true }, 
      order: { public_time: 'DESC' }
    })).filter(article =>
      // Show only announcements made within 15 days.
      syzoj.utils.getCurrentDate() - article.public_time < 15 * 24 * 3600
    ).map(article => ({
      title: article.title,
      url: syzoj.utils.makeUrl(['article', article.id]),
      date: syzoj.utils.formatDate(article.public_time, 'L')
    }));

    let contests = await Contest.queryRange([1, 3], Contest.createQueryBuilder()
      .where({ admins: TypeORM.Not(TypeORM.IsNull()), is_public: true })
      // Show active contests only.
      .andWhere(new TypeORM.Brackets(qb => {
        qb.where('end_time IS NULL')
          .orWhere('UNIX_TIMESTAMP(CURRENT_TIMESTAMP) < end_time')
      }))
      // Contests started later come first.
      .orderBy('(CASE WHEN start_time IS NULL THEN (CASE WHEN end_time IS NULL THEN 0 ELSE end_time - duration END) ELSE start_time END)', 'DESC')
    );

    let ranklist = await User.queryRange([1, 10], { is_show: true }, {
      [syzoj.config.sorting.ranklist.field]: syzoj.config.sorting.ranklist.order
    });
    await ranklist.forEachAsync(async x => x.renderInformation());

    res.render('index', {
      notices: notices,
      contests: contests,
      ranklist: ranklist
    });
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});

app.get('/help', async (req, res) => {
  try {
    res.render('help');
  } catch (e) {
    syzoj.log(e);
    res.render('error', {
      err: e
    });
  }
});
