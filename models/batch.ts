import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

import Course from "./course";
import User from "./user";

@TypeORM.Entity()
export default class Batch extends Model {
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

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  course_id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  lessons: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  participants: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  owner_id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  admins: string;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  course?: Course;
  owner?: User;

  async loadRelationships() {
    this.course = await Course.findById(this.course_id);
    this.owner = await User.findById(this.owner_id);
  }

  async isCourseOwner(user) {
    if (!user) return false;
    if (user.is_admin) return true;
    this.course = await Course.findById(this.course_id);
    return await this.course.hasOwnership(user);
  }

  async hasOwnership(user) {
    return await this.isCourseOwner(user) || (user && user.id === this.owner_id);
  }

  async isSupervisior(user) {
    return await this.hasOwnership(user) || (user && this.admins.split('|').includes(user.id.toString()));
  }

  async getTeacher() {
    if (!this.admins) return this.owner_id;
    return this.admins.split('|')[0];
  }

  async getLessons() {
    if (!this.lessons) return [];
    return this.lessons.split('|').map(x => parseInt(x));
  }

  isRunning(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return (!this.start_time || this.start_time <= now) && (!this.end_time || now < this.end_time);
  }

  isEnded(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return this.end_time && this.end_time <= now;
  }
}
