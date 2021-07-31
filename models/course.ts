import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj, ErrorMessage: any;

import User from "./user";
import Contest from "./contest";

@TypeORM.Entity()
export default class Course extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  subtitle: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  start_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  end_time: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  holder_id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  information: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  contests: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  admins: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  participants: string;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  holder?: User;

  async loadRelationships() {
    this.holder = await User.findById(this.holder_id);
  }

  async isSupervisior(user) {
    return user && (user.is_admin || this.holder_id === user.id || this.admins.split('|').includes(user.id.toString()));
  }

  async isParticipant(user) {
    return user && this.participants.split('|').includes(user.id.toString());
  }

  async getContests() {
    if (!this.contests) return [];
    return this.contests.split('|').map(x => parseInt(x));
  }

  async setContestsNoCheck(contestIDs) {
    this.contests = contestIDs.join('|');
  }

  async setContests(s) {
    let a = [];
    await s.split('|').forEachAsync(async x => {
      let contest = await Contest.findById(x);
      if (!contest) return;
      a.push(x);
    });
    this.contests = a.join('|');
  }

  isRunning(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return now >= this.start_time && now < this.end_time;
  }

  isEnded(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return now >= this.end_time;
  }
}
