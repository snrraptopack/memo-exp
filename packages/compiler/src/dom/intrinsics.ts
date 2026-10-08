/** Lower validated authoring intrinsic imports for this backend. */
import * as astFactory from '../ast/factory';
import {refreshAstAnalysis,type Ctx,type ProgramPath} from '../context';
import {planCompilerIntrinsics} from '../intrinsics';
export function installCompilerIntrinsics(ctx:Ctx,program:ProgramPath):void {
  refreshAstAnalysis(ctx,program.node);
  const imports=planCompilerIntrinsics(ctx,program);
  for(const {module,names} of imports){
    if(names.includes('$routed'))ctx.importedValues.add('$routed');
    program.node.body.unshift(astFactory.importDeclaration(
      names.map(name=>astFactory.importSpecifier(astFactory.identifier(name),astFactory.identifier(name))),
      astFactory.stringLiteral(module)));
  }
  if(imports.length)refreshAstAnalysis(ctx,program.node);
}
