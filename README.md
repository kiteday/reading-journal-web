# Reading Journal Web

웹앱: https://kiteday.github.io/reading-journal-web/

이 저장소에는 Reading Journal의 웹앱 코드만 있습니다. iOS Capacitor 프로젝트와 서버·DB 마이그레이션은 기존 비공개 `reading-journal` 저장소에 남아 있습니다. 두 저장소는 자동으로 동기화되지 않습니다.

로컬 실행:

```sh
cp .env.example .env.local
# .env.local에 Supabase URL과 publishable key 입력
npm ci
npm run dev
```

배포 빌드: `npm run build -- --base=/reading-journal-web/`. GitHub Pages는 `gh-pages` 브랜치의 빌드 결과를 제공하며, 현재 `main` 변경만으로는 자동 재배포되지 않습니다. `.env.local`과 비밀키는 Git에 올리지 않습니다.
