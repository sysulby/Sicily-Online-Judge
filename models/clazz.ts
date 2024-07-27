import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj: any;

import User from "./user";
import Course from "./course";
import ClazzStudent from "./clazz_student";

@TypeORM.Entity()
export default class Clazz extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  start_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  end_time: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  information: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  lessons: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  owner_id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  teachers: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  reg_info: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  reg_start_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  reg_end_time: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  course_id: number;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  owner?: User;
  course?: Course;

  async loadRelationships() {
    this.owner = await User.findById(this.owner_id);
    this.course = await Course.findById(this.course_id);
  }

  async isCourseOwner(user) {
    if (!user) return false;
    if (user.is_admin) return true;
    this.course = await Course.findById(this.course_id);
    return await this.course.hasOwnership(user);
  }

  async hasOwnership(user) {
    return user && (user.id === this.owner_id || await user.hasPrivilege('manage_class') || await this.isCourseOwner(user));
  }

  async isSupervisior(user) {
    return user && (this.teachers.split('|').includes(user.id.toString()) || await this.hasOwnership(user));
  }

  async isStudent(user) {
    if (!user) return false;
    let student = await ClazzStudent.findInClazz({
      class_id: this.id,
      user_id: user.id
    });
    return student && student.status === 'Accepted';
  }

  async isParticipant(user) {
    if (!user) return false;
    if (user.id === this.owner_id || this.teachers.split('|').includes(user.id.toString())) return true;
    let student = await ClazzStudent.findInClazz({
      class_id: this.id,
      user_id: user.id
    });
    if (!student) return false;
    if (student.status === 'Accepted' || student.status === 'Waiting') return true;
    return !this.isEnded() && syzoj.utils.getCurrentDate() - student.last_modified <= 3600 * 24 * 10;
  }

  async getMainTeacher() {
    if (!this.teachers) return this.owner_id;
    return this.teachers.split('|')[0];
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
