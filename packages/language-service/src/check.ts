import * as ts from 'typescript';
import { runProjectCheck } from './project-check';

const result = runProjectCheck(ts, process.argv.slice(2));
process.stdout.write(result.output);
process.exitCode = result.exitCode;
