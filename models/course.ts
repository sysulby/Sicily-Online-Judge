import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

import User from "./user";

@TypeORM.Entity()
export default class Course extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  subtitle: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  information: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  start_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  end_time: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  contests: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  participants: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  owner_id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  admins: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  parent_id: number;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  owner?: User;
  parent?: Course;

  async loadRelationships() {
    this.owner = await User.findById(this.owner_id);
    this.parent = await Course.findById(this.parent_id);
  }

  async isSupervisior(user) {
    return user && (
      user.is_admin ||
      this.owner_id === user.id ||
      this.admins.split('|').includes(user.id.toString()));
  }

  async getContests() {
    if (!this.contests) return [];
    return this.contests.split('|').map(x => parseInt(x));
  }

  isRunning(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return !this.start_time || (this.start_time <= now && now < this.end_time);
  }

  isEnded(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return this.end_time && this.end_time <= now;
  }
}
