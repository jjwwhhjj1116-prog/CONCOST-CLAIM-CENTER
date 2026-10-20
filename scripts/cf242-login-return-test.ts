import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {resolveLoginReturnTo} from '../apps/web/src/login-return.js';
const safe=(path:string)=>['/dashboard','/reports/studio','/approval','/staff-admin'].includes(path.split('?')[0]);
const report='/reports/studio?caseId=11111111-1111-4111-8111-111111111111&step=5';
const review='/approval?reviewId=22222222-2222-4222-8222-222222222222';
test('CF242 both email deep links retain full query directly and through explicit login returnTo',()=>{
 for(const path of [report,review,report+'&filter=a%2Bb%20c&repeat=1&repeat=2']){
  assert.equal(resolveLoginReturnTo(path,safe),path);
  assert.equal(resolveLoginReturnTo('/login?returnTo='+encodeURIComponent(path),safe),path);
 }
 assert.equal(resolveLoginReturnTo(report+'&returnTo='+encodeURIComponent(review),safe),review);
});
test('CF242 external, encoded, network-path, backslash, login loop and unknown destinations fall back',()=>{
 for(const bad of ['https://evil.invalid/approval','//evil.invalid/approval','/\\evil.invalid','\\evil.invalid','/login','/login?returnTo='+encodeURIComponent(report),'/unknown','%2F%2Fevil.invalid','/%5Cevil.invalid']){
  assert.equal(resolveLoginReturnTo('/login?returnTo='+encodeURIComponent(bad),safe),'/dashboard',bad);
 }
 for(const bad of ['https://evil.invalid/approval','//evil.invalid/approval','/\\evil.invalid','/login','/unknown'])assert.equal(resolveLoginReturnTo(bad,safe),'/dashboard',bad);
});
test('CF242 helper delegates known-route policy without granting staff access',()=>{
 assert.equal(resolveLoginReturnTo('/staff-admin?tab=users',safe),'/staff-admin?tab=users');
 assert.equal(resolveLoginReturnTo('/staff-admin?tab=users',()=>false),'/dashboard');
 assert.equal(resolveLoginReturnTo('/login?returnTo='+encodeURIComponent(report),()=>false),'/dashboard');
});
test('CF242 App uses shared helper for login and session expiry, retaining current search',()=>{
 const app=readFileSync('apps/web/src/App.tsx','utf8');
 assert.match(app,/import[^;]*resolveLoginReturnTo[^;]*login-return/u);
 assert.ok((app.match(/resolveLoginReturnTo\(/g)||[]).length>=2);
 const expiry=app.slice(app.indexOf('const expireSession'),app.indexOf('const expireSession')+1000);
 assert.match(expiry,/resolveLoginReturnTo/u);assert.match(expiry,/currentLocationRef\.current/u);assert.match(app,/currentBrowserLocation = \(\) =>.*window\.location\.pathname.*window\.location\.search/u);assert.match(app,/useState\(currentBrowserLocation\)/u);
});

