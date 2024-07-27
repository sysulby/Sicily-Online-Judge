import * as TypeORM from "typeorm";
import Model from "./common";

import User from "./user";
import Clazz from "./clazz";

enum Status {
  ACCEPTED = "Accepted",
  REJECTED = "Rejected",
  REMOVED = "Removed",
  WAITING = "Waiting"
}

@TypeORM.Entity()
export default class ClazzStudent extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  class_id: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  user_id: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  reg_time: number;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "enum", enum: Status })
  status: Status;

  @TypeORM.Column({ nullable: true, type: "text" })
  feedback: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  last_modified: number;

  user?: User;
  clazz?: Clazz;

  static async findInClazz(where) {
    return ClazzStudent.findOne({ where: where });
  }

  async loadRelationships() {
    this.user = await User.findById(this.user_id);
    this.clazz = await Clazz.findById(this.class_id);
  }
}
