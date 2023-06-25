import * as TypeORM from "typeorm";
import Model from "./common";

import User from "./user";

@TypeORM.Entity()
export default class ProblemSet extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  title: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  subtitle: string;

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  owner_id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  admins: string;

  @TypeORM.Column({ nullable: true, type: "boolean" })
  is_public: boolean;

  owner?: User;

  async loadRelationships() {
    this.owner = await User.findById(this.owner_id);
  }

  async hasOwnership(user) {
    return user && (user.id === this.owner_id || await user.hasPrivilege('manage_problem'));
  }

  async isSupervisior(user) {
    return user && (this.admins.split('|').includes(user.id.toString()) || await this.hasOwnership(user));
  }
}
