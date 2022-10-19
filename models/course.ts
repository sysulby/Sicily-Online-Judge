import * as TypeORM from "typeorm";
import Model from "./common";

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

  @TypeORM.Column({ nullable: true, type: "text" })
  lessons: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  owner_id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  teachers: string;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  owner?: User;

  async loadRelationships() {
    this.owner = await User.findById(this.owner_id);
  }

  async hasOwnership(user) {
    return user && (user.is_admin || user.id === this.owner_id);
  }

  async isSupervisior(user) {
    return await this.hasOwnership(user) || (user && this.teachers.split('|').includes(user.id.toString()));
  }

  async getLessons() {
    if (!this.lessons) return [];
    return this.lessons.split('|').map(x => parseInt(x));
  }
}
