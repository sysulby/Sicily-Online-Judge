import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj, ErrorMessage: any;

@TypeORM.Entity()
export default class Cipher extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  token: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  expire_time: number;

  isExpired(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return this.expire_time && now > this.expire_time;
  }
}
