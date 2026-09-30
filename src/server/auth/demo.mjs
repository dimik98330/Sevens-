// Explicit public sandbox access; never an arbitrary-user or admin login.
import { createSession, revokeSession } from './session.mjs';

const ACCOUNTS={
  CITIZEN:{id:'c588cb06-c085-5862-ad66-7e1b28a2dc2f',email:'citizen1@example.test'},
  STAFF:{id:'4c6fc5b4-0240-58e7-9303-e1fb4049c0c2',email:'transport@example.test'},
};
export function demoLoginEnabled(env=process.env){
  return ['demo','test'].includes(env.APP_ENV)&&env.DEMO_LOGIN_ENABLED==='true';
}
export async function demoLogin(db,role,{enabled=demoLoginEnabled(),previousSession=null}={}){
  if(!enabled){const error=new Error('Нет доступа');error.code='NOT_FOUND';throw error;}
  if(!Object.hasOwn(ACCOUNTS,role)){
    const error=new Error('Выберите демонстрационную роль');error.code='VALIDATION_ERROR';throw error;
  }
  const account=ACCOUNTS[role];
  return db.transaction(async(tx)=>{
    const result=await tx.query(`SELECT u.id,u.display_name,u.role,u.organization_id,u.region_id
      FROM users u JOIN regions r ON r.id=u.region_id
      LEFT JOIN organizations o ON o.id=u.organization_id
      WHERE u.id=$1 AND u.email_normalized=$2 AND u.role=$3 AND u.active
        AND r.code='ABAI' AND r.active
        AND (($3='CITIZEN' AND u.organization_id IS NULL)
          OR ($3='STAFF' AND o.code='DEMO_TRANSPORT' AND o.is_demo AND o.active AND o.region_id=u.region_id))
      FOR SHARE OF u,r`,[account.id,account.email,role]);
    const user=result.rows[0];
    if(!user){const error=new Error('Демонстрационные аккаунты пока недоступны');error.code='SERVICE_UNAVAILABLE';throw error;}
    const session=await createSession(tx,user.id);
    if(previousSession)await revokeSession(tx,previousSession.id);
    return {user,session};
  });
}
