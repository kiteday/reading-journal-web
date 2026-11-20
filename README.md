# 개발용 Supabase 로그인 연결

개발 프로젝트: [reading-journal-dev](https://supabase.com/dashboard/project/wcfermblyfvgidozjvuz) (서울 리전·Free 조직). CLI 연결·서가 migration·웹/검증용 iOS 앱 리다이렉트 등록 완료. `web/.env.local`에는 프로젝트 URL과 **publishable key만** 저장되어 있으며 Git에서 제외된다. 웹 Google 로그인과 새로고침 후 세션 유지는 확인했다.

정식 iOS 앱은 `web/ios`에 있고 ID는 `com.kiteday.readingjournal`이다. 기존 SwiftUI 앱과 같은 ID이므로 이번 베타에서는 기존 앱을 **삭제한 후** 설치한다. 덮어쓰기는 구형 앱 데이터가 남아 있을 때 검은 화면이 재현되어 지원하지 않는다. 실행: `cd web && npm install && npm run build:ios:beta && npx cap sync ios && npx cap open ios`. Google 로그인은 앱 밖 Safari 화면을 거쳐 Supabase에 이미 등록된 `com.kiteday.readingjournal.prototype://auth/callback`으로 돌아오는 PKCE 흐름이다. 이 내부 URL 스킴은 Bundle ID와는 다르다. 새 시뮬레이터에서 로그인 화면 표시를 확인했다. 세션은 웹뷰 저장소에 남는다.

iOS 테스트 배너를 확인할 때는 `npm run build:ios:dev`를 쓴다. `ios-dev` 빌드는 Google 공식 테스트 광고 단위, `ios-beta`와 일반 빌드는 Reading Journal 실제 광고 단위를 사용한다. 정식 출시 전 AdMob 앱 등록 정보와 광고 정책을 다시 검증한다. 2026-10-27 AdMob의 **개인정보 보호 및 메시지 → 유럽 규정**에서 앱 ID `ca-app-pub-6828399849556449~1980714279`에 Reading Journal 전용 메시지를 게시하고 개인정보처리방침 URL `https://kiteday.github.io/readingjournal/`을 연결했다. 시뮬레이터의 동의 확인 후 테스트 배너 표시도 확인했다. 메시지는 EEA·영국·스위스 대상이므로 한국에서는 팝업이 나타나지 않는 것이 정상일 수 있다. iOS 추적 허용(ATT) 팝업과는 별개이며, 이 앱은 비추적 광고를 사용하므로 ATT 팝업을 추가하지 않는다.

남은 제공자 설정·검증:

1. Google 제공자는 설정 완료. 웹 OAuth **Web application**의 JavaScript origin은 `http://localhost:5173`, redirect URI는 `https://wcfermblyfvgidozjvuz.supabase.co/auth/v1/callback`이다. Client ID와 Secret은 [Supabase Google 제공자](https://supabase.com/dashboard/project/wcfermblyfvgidozjvuz/auth/providers)에만 둔다.
2. iOS 네이티브 Apple 로그인 코드와 Apple Developer App ID의 기능, Supabase Apple 제공자 Client ID(`com.kiteday.readingjournal`)를 연결했다. 실기기 로그인·재실행·로그아웃 검증은 아직 필요하다. 웹 Apple 버튼은 비활성화 상태다. 나중에 웹 Apple 로그인까지 열려면 Services ID·signing key와 별도 서버 알림 수신 경로가 필요하다. `.p8` 키는 저장소에 넣지 않는다.
3. `cd web && npm install && npm run dev`로 웹을 연다. 웹 Apple 버튼은 Services ID가 없어 비활성화했다. `service_role`/secret key는 클라이언트에 넣지 않는다. 웹을 배포할 때는 실제 HTTPS 주소를 Supabase Redirect URL에 추가한다.

Google·Apple 로그인 뒤 같은 서가가 보이는 기준은 Supabase의 **동일한 user ID**다. 같은 확인된 이메일은 자동 연결될 수 있지만, Apple의 이메일 가리기를 선택하면 별도 계정이 될 수 있다. 이 단계에서는 자동 데이터 병합을 하지 않는다.

남은 통합 확인: iOS 앱 Google 로그인 → 책 추가 → 앱 재시작 후 유지 → 웹에서 같은 계정으로 조회 → 로그아웃 후 개인 서가 접근 차단. Apple OAuth와 실기기 검증은 별도다.

DB 보안 회귀 테스트는 `supabase test db --linked`로 실행한다. Docker 실행 환경은 Colima이며 재부팅 후 `colima start`로 시작한다. 작업하지 않을 때는 `colima stop`으로 메모리 사용을 멈출 수 있다.
