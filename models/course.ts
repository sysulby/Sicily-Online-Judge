import * as TypeORM from "typeorm";
import Model from "./common";

declare var syzoj, ErrorMessage: any;

import User from "./user";
import ProblemSetMap from "./problem_set_map";

import * as fs from "fs-extra";
import * as path from "path";
import * as util from "util";

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

  @TypeORM.Index()
  @TypeORM.Column({ nullable: true, type: "integer" })
  owner_id: number;

  @TypeORM.Column({ nullable: true, type: "text" })
  teachers: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  problem_sets: string;

  @TypeORM.Column({ nullable: true, type: "text" })
  lessons: string;

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
    return user && (await this.hasOwnership(user) || this.teachers.split('|').includes(user.id.toString()));
  }

  async hasProblem(problem) {
    for (let setID of this.problem_sets.split('|')) {
      if (await ProblemSetMap.findOne({ where: { problem_id: problem.id, set_id: setID } })) return true;
    }
    return false;
  }

  async getLessons() {
    if (!this.lessons) return [];
    return this.lessons.split('|').map(x => parseInt(x));
  }

  getCourseFilePath() {
    return syzoj.utils.resolvePath(syzoj.config.upload_dir, 'course_file', this.id.toString());
  }

  async updateCourseFile(path, noLimit) {
    await syzoj.utils.lock(['Problem::CourseFile', this.id], async () => {
      let unzipSize = 0, unzipCount = 0;
      let p7zip = new (require('node-7z'));
      await p7zip.list(path).progress(files => {
        unzipCount += files.length;
        for (let file of files) unzipSize += file.size;
      });
      if (!noLimit && unzipCount > syzoj.config.limit.testdata_filecount) throw new ErrorMessage('数据包中的文件太多。');
      if (!noLimit && unzipSize > syzoj.config.limit.testdata) throw new ErrorMessage('数据包太大。');

      let dir = this.getCourseFilePath();
      await fs.remove(dir);
      await fs.ensureDir(dir);

      let execFileAsync = util.promisify(require('child_process').execFile);
      await execFileAsync(__dirname + '/../bin/unzip', ['-j', '-o', '-d', dir, path]);
    });
  }

  async uploadCourseSingleFile(filename, filepath, size, noLimit) {
    await syzoj.utils.lock(['Promise::CourseFile', this.id], async () => {
      let dir = this.getCourseFilePath();
      await fs.ensureDir(dir);

      let oldSize = 0, list = await this.listCourseFile(), replace = false, oldCount = 0;
      if (list) {
        oldCount = list.files.length;
        for (let file of list.files) {
          if (file.filename !== filename) oldSize += file.size;
          else replace = true;
        }
      }

      if (!noLimit && oldSize + size > syzoj.config.limit.testdata) throw new ErrorMessage('数据包太大。');
      if (!noLimit && oldCount + (!replace as any as number) > syzoj.config.limit.testdata_filecount) throw new ErrorMessage('数据包中的文件太多。');

      await fs.move(filepath, path.join(dir, filename), { overwrite: true });

      let execFileAsync = util.promisify(require('child_process').execFile);
      try { await execFileAsync('dos2unix', [path.join(dir, filename)]); } catch (e) {}
    });
  }

  async deleteCourseSingleFile(filename) {
    await syzoj.utils.lock(['Promise::CourseFile', this.id], async () => {
      await fs.remove(path.join(this.getCourseFilePath(), filename));
    });
  }

  async listCourseFile() {
    try {
      let dir = this.getCourseFilePath();
      let filenameList = await fs.readdir(dir);
      let list = await Promise.all(filenameList.map(async x => {
        let stat = await fs.stat(path.join(dir, x));
        if (!stat.isFile()) return undefined;
        return {
          filename: x,
          size: stat.size
        };
      }));

      list = list.filter(x => x);

      let res = {
        files: list,
        zip: null
      };

      return res;
    } catch (e) {
      return null;
    }
  }
}
