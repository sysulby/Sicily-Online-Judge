import * as TypeORM from "typeorm";
import Model from "./common";

import * as fs from "fs-extra";

declare var syzoj: any;

import User from "./user";

@TypeORM.Entity()
export default class Resume extends Model {
  static cache = true;

  @TypeORM.PrimaryGeneratedColumn()
  id: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  name: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  school: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  graduation_year: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 80 })
  contact: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 11 })
  phone_number: string;

  @TypeORM.Column({ nullable: true, type: "integer" })
  relationship: number;

  @TypeORM.Column({ nullable: true, type: "decimal", precision: 4, scale: 1 })
  score: number;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  award1: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  award2: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  award3: string;

  @TypeORM.Column({ nullable: true, type: "varchar", length: 120 })
  award4: string;

  user?: User;

  async loadRelationships() {
    this.user = await User.findById(this.id);
  }

  getResumeFilePath() {
    return syzoj.utils.resolvePath(syzoj.config.upload_dir, 'resume', this.id.toString() + '.pdf');
  }

  async loadResumeFile() {
    try {
      let user = await User.findById(this.id);
      let stat = await fs.stat(await this.getResumeFilePath());
      if (!stat.isFile()) return undefined;
      return {
        filename: user.username + '.pdf',
        size: stat.size
      };
    } catch (e) {
      return null;
    }
  }

  async updateResumeFile(path) {
    await fs.move(path, this.getResumeFilePath(), { overwrite: true });
  }

  async deleteResumeFile() {
    await syzoj.utils.lock(['Promise::ResumeFile', this.id], async () => {
      await fs.remove(this.getResumeFilePath());
    });
  }
}
