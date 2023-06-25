import * as TypeORM from "typeorm";
import Model from "./common";

@TypeORM.Entity()
export default class ProblemSetMap extends Model {
  @TypeORM.Index()
  @TypeORM.PrimaryColumn({ type: "integer" })
  problem_id: number;

  @TypeORM.Index()
  @TypeORM.PrimaryColumn({ type: "integer" })
  set_id: number;
}
