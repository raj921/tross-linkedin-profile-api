# Gates: Tross LinkedIn Profile API

OWNS: *

Scope: Hosted HTTPS API that takes a LinkedIn profile URL and returns structured JSON (name, headline, location, about, experience, education, skills, certifications, languages, images) via pure reverse-engineered Voyager endpoint calls — no browser in the solution — with public repo, README, and zero secrets.

- [ ] G1: API accepts a LinkedIn profile URL and returns all required fields as structured JSON
  CHECK: LI_LIVE=1 node scripts/check.mjs
  EXPECT: live api check passed
  EVIDENCE: pending

- [x] G2: LinkedIn fetch path is pure reverse-engineered HTTP — no browser automation anywhere in the deliverable
  CHECK: node -e "const p=require('./package.json');const s=JSON.stringify(p)+require('fs').readFileSync('li.js','utf8');if(/playwright|puppeteer|selenium|chromedp|ego-browser/i.test(s)){console.error('browser dep found');process.exit(1)}console.log('no browser automation present')"
  EXPECT: no browser automation present
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajkumar/ontrossassement; path=ac7c8d218e22/62 entries; EXPECT=matched; output-sha256=61497c2a116782a93a5b44dea65beaf08b5b79a9bf0ddcfc8a272afcae6f1113; output-bytes=30

- [x] G3: No credentials or secrets in the repo
  CHECK: node -e "const {execSync}=require('child_process');const files=execSync('git ls-files').toString().trim().split('\n').filter(f=>f&&!f.startsWith('fixtures/'));let bad=0;for(const f of files){const c=require('fs').readFileSync(f,'utf8');if(/AQE[A-Za-z0-9_-]{40,}|li_at=[A-Za-z0-9_-]{10,}/.test(c)){console.error('secret in',f);bad=1}}if(bad)process.exit(1);console.log('no secrets in tracked files')"
  EXPECT: no secrets in tracked files
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajkumar/ontrossassement; path=ac7c8d218e22/62 entries; EXPECT=matched; output-sha256=141e996f77d6da1e6f5a62a52395599180af53591ec3c991341f8e7b7c776329; output-bytes=28

- [x] G4: README covers setup instructions, API documentation, approach, and known limitations
  CHECK: node -e "const c=require('fs').readFileSync('README.md','utf8').toLowerCase();for(const s of ['setup','api','approach','limitation']){if(!c.includes(s)){console.error('missing section:',s);process.exit(1)}}console.log('README sections present')"
  EXPECT: README sections present
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajkumar/ontrossassement; path=ac7c8d218e22/62 entries; EXPECT=matched; output-sha256=ee89226e56a4cf24ecf8cd6095b234e3158b72877ae26a20c79d27a72b6ffc71; output-bytes=24

- [ ] G5: API is deployed publicly over HTTPS and answers a real profile lookup
  CHECK: node -e "const u=process.env.PUBLIC_URL;if(!u){console.error('PUBLIC_URL not set');process.exit(1)}const r=await fetch(u+'/profile?url=https://www.linkedin.com/in/williamhgates/');if(r.status!==200){console.error('status',r.status);process.exit(1)}const j=await r.json();if(!j.name||!j.experience?.length){console.error('bad payload');process.exit(1)}console.log('public deployment verified')"
  EXPECT: public deployment verified
  EVIDENCE: pending

- [x] G6: Source is on a public GitHub repository
  CHECK: node -e "const r=await fetch('https://api.github.com/repos/raj921/tross-linkedin-profile-api');const j=await r.json();if(j.private!==false){console.error('repo not public');process.exit(1)}console.log('public repo verified')"
  EXPECT: public repo verified
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/rajkumar/ontrossassement; path=ac7c8d218e22/62 entries; EXPECT=matched; output-sha256=2e04979349698cc50402241d1d05818da59c344a4fcf52917fc4123781fa4f65; output-bytes=21
