import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj, ErrorMessage: any;

@TypeORM.Entity()
export default class RegToken extends Model {
  @TypeORM.Index()
  @TypeORM.PrimaryColumn({ type: "varchar", length: 6 })
  token: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  expire_time: number;

  @TypeORM.Column({ nullable: true, type: "integer" })
  creator_id: number;

  isExpired(now?) {
    if (!now) now = syzoj.utils.getCurrentDate();
    return this.expire_time && now > this.expire_time;
  }
}
