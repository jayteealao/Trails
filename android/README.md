<p align="center">
  <img src="app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.webp" width="100" alt="Trails logo" />
</p>

<h1 align="center">Trails</h1>

<p align="center">
  Save articles from anywhere, read them offline, and organize with tags — your personal reading archive on Android.
</p>

<p align="center">
  <img alt="Min SDK" src="https://img.shields.io/badge/min%20SDK-24-blue" />
  <img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-green" />
  <img alt="Kotlin" src="https://img.shields.io/badge/Kotlin-2.4-7F52FF?logo=kotlin&logoColor=white" />
  <img alt="Jetpack Compose" src="https://img.shields.io/badge/Jetpack%20Compose-Material%203-4285F4?logo=jetpackcompose&logoColor=white" />
</p>

---

<!-- TODO: Add demo GIF here — screen recording of saving an article via share sheet, browsing the list, and reading offline -->

## Highlights

- **Share and save** — Tap share in any browser or app, and the article is archived instantly with a one-tap undo
- **Read offline** — Full article text is extracted and stored locally so you can read without a connection
- **Organize with tags** — Add, remove, and get AI-suggested tags to keep your reading list navigable
- **Find anything fast** — Full-text search across all saved articles, titles, and content in milliseconds
- **Sync across devices** — Cloud backup via Firebase with background sync, so your library follows you
- **Material You theming** — Adapts to your wallpaper colors on Android 12+, with full dark mode support

---

## Overview

Trails is an offline-first Android reading app. Save articles from any app's share sheet, and Trails extracts the readable content, stores it locally, and syncs it to Firebase so your library is available across devices. Articles can be tagged, favorited, archived, and searched with full-text indexing.

It uses Google Gemini for AI-powered tag suggestions and syncs to a Firebase backend for cross-device access. The app follows Material 3 design guidelines with adaptive layouts for phones, tablets, and foldables.

Built as a personal project by [@jayteealao](https://github.com/jayteealao) to replace fragmented bookmark workflows with a single, fast, offline-capable reading archive.

## Requirements

- Android 7.0+ (API 24)
- Google account (for sync — optional, guest mode available)

## Installation

Download the latest APK from [Releases](../../releases) and install it, or build from source (see [Development](#development) below).

## Usage

### Save an article

1. Open any article in your browser or app
2. Tap **Share** and select **Trails**
3. The article is saved, text extracted, and synced to the cloud

### Organize your library

- **Tags** — Long-press an article to manage tags. Trails can suggest tags using Gemini AI.
- **Favorites** — Star articles you want to revisit
- **Archive** — Move read articles out of your main list
- **Search** — Tap the search bar to find any article by title or content

---

## Development

### Prerequisites

| Tool | Version |
|------|---------|
| Android Studio | Ladybug or later |
| JDK | 21 |
| Gradle | 9.3.1 (wrapper included) |
| Kotlin | 2.4.21 |

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/jayteealao/Trails.git
   cd Trails
   ```

2. Set up Firebase (see [Firebase Backend Setup](#firebase-backend-setup) below)

3. Build and run:
   ```bash
   ./gradlew assembleDebug
   ```

### Running tests

```bash
# Unit tests
./gradlew :app:testDebugUnitTest

# All tests
./gradlew test
```

### Release signing

Release builds are signed with the release key, and the release APK also carries a key-rotation lineage from the debug key. That lineage lets a release APK install as an update over a debug build of the app, so nothing on the device is lost.

**The two keystores**

| Keystore | Where it lives | Role |
|----------|----------------|------|
| Release keystore | Outside the repository, on the maintainer's machine; the `SIGNING_STORE_FILE_B64` CI secret holds a base64 copy | Signs the AAB. It is the APK's next signer, used by Android 13 and newer |
| Debug keystore | `~/.android/debug.keystore`, the SDK's default; the `DEBUG_KEYSTORE_B64` CI secret holds a base64 copy | The APK's original signer, used by Android 7 to 12 and as the start of the lineage |

Neither keystore is ever committed. `.jks`, `.keystore` and `.p12` files are git-ignored.

**The lineage file**

`app/trails.lineage` is committed. It holds the two certificates and the debug key's signature over the release certificate. It contains no private key. It was created once, from the debug keystore that signed the installed app and the release keystore, with:

```bash
apksigner rotate --out app/trails.lineage \
  --old-signer --ks ~/.android/debug.keystore --ks-key-alias androiddebugkey --ks-pass pass:android \
  --new-signer --ks <release keystore> --ks-key-alias <release alias>
```

Every release from now on must carry this lineage. Do not regenerate or replace the file. To check it, run `apksigner lineage --in app/trails.lineage --print-certs`. It lists two signers: the debug certificate, then the release certificate.

**Configuring a release build**

Set these values as environment variables, as `-P` Gradle properties, or in `android/local.properties`, which is checked in that order. `local.properties.example` lists every value.

- `SIGNING_STORE_FILE`, `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS` and `SIGNING_KEY_PASSWORD` are the release keystore and key.
- `SIGNING_DEBUG_STORE_FILE` is the debug keystore. It defaults to `~/.android/debug.keystore`.
- `SIGNING_LINEAGE_FILE` is the lineage. It defaults to `app/trails.lineage`.

Then build:

```bash
./gradlew assembleRelease bundleRelease
```

`assembleRelease` packages the APK and then re-signs it with `apksigner` from build-tools 36.0.0. v1, v2 and v3 are signed by the debug key, and v3.1 by the release key with the lineage. It then verifies the APK and its `.idsig` before it replaces them. If any step fails, the APK is deleted and the build fails. The AAB is signed with the release key only.

`packageRelease` on its own produces an APK without the lineage, so it is not a release build. Use `assembleRelease`, or `installRelease` to install from Gradle.

**The fail rule**

`assembleRelease` and `bundleRelease` have no fallback signer. When a value is missing, they fail before signing with one message that names every missing value:

```text
Release signing is not configured. Missing: SIGNING_STORE_FILE, SIGNING_STORE_PASSWORD, SIGNING_KEY_ALIAS, SIGNING_KEY_PASSWORD. Set them as environment variables, -P properties or in android/local.properties (see android/local.properties.example).
```

Debug builds and unit tests never need these values. That covers `assembleDebug`, `testDebugUnitTest`, `test` and the pull-request check.

**CI secrets**

The two release workflows (`manual-release.yml`, `release-on-tag.yml`) need two groups of repository secrets:

- `SIGNING_STORE_FILE_B64` holds the base64 release keystore. `SIGNING_STORE_PASSWORD`, `SIGNING_KEY_ALIAS` and `SIGNING_KEY_PASSWORD` go with it.
- `DEBUG_KEYSTORE_B64` holds the base64 debug keystore: the same keystore whose certificate is the lineage's first signer.

To create a base64 value, run `base64 -w0 < <keystore>` (on macOS, `base64 -i <keystore>`).

**Devices below Android 13**

The rotated key is used from Android 13 (API 33). On Android 7 to 12 the release APK is signed by the debug key, so it installs over a debug build there too, and those devices keep trusting only the debug key. A device below Android 13 therefore needs a one-time uninstall before it can move to a build signed by the release key alone. The uninstall deletes the app's data.

**The rotation is one way**

The lineage grants no rollback capability. After a release-signed build is installed on an Android 13 or newer device, an APK signed only by the debug key cannot install over it: Android refuses it with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. That covers the debug build from Android Studio, the pull-request check's debug APK and every release that was signed by the debug key before the rotation.

- To run a debug build on that device again, uninstall the app first. The uninstall deletes the app's data.
- To fix a bad release, ship a new release-signed build with a higher version code. Do not go back to an older release, and do not reinstall an APK from before the rotation.

**Checking the signing setup without the real keys**

Release builds need both keystores, so the harness generates throwaway ones under `app/build/signing-harness/` (git-ignored) and checks every case. It covers the signed outputs and their lineage, each missing or broken input, and the workflows' decode steps. Run it from the repository root:

```bash
bash android/scripts/release-signing-harness.sh        # all cases
bash android/scripts/release-signing-harness.sh pass   # one case
```

The script runs `./gradlew clean` once before it generates the keys. Each case prints `PASS` or `FAIL`. Logs go to `.scratch/signing-harness/` at the repository root.

To build a release against the throwaway keys by hand, run these commands from `android/`:

```bash
./gradlew :app:generateSigningHarness
source app/build/signing-harness/harness.env
./gradlew assembleRelease
```

Do not add `clean` to the last command, because `clean` deletes the throwaway keys.

## Firebase Backend Setup

Trails uses Firebase for authentication and cloud sync. You need your own Firebase project to build from source.

### 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a new project
2. Enter a project name (e.g. "Trails") and follow the wizard
3. Google Analytics is optional — you can disable it

### 2. Register the Android app

1. In the Firebase console, click **Add app** → **Android**
2. Set the package name to `com.jayteealao.trails`
3. Download the generated `google-services.json`
4. Place it in the `app/` directory (it is gitignored)

### 3. Enable Authentication

1. In the Firebase console, go to **Authentication** → **Sign-in method**
2. Enable **Google** as a sign-in provider
3. Set the support email to your email address
4. Enable **Anonymous** sign-in (allows guest mode before the user links a Google account)
5. Copy your project's **Web client ID** (found in the Google provider settings) and update `app/src/main/res/values/strings.xml`:
   ```xml
   <string name="default_web_client_id">YOUR_WEB_CLIENT_ID</string>
   ```

### 4. Set up Cloud Firestore

1. In the Firebase console, go to **Firestore Database** → **Create database**
2. Choose **Production mode** (you'll deploy security rules next)
3. Select a region close to your users

#### Deploy security rules

The repository includes `firestore.rules` with per-user data isolation. Deploy them with the Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

#### Firestore data structure

Trails stores all data under `users/{userId}/`:

```
users/{userId}/
├── articles/{articleId}       # Article metadata (title, url, excerpt, timestamps)
│   ├── tags/{tagId}           # Tags for this article
│   ├── images/{imageId}       # Article images
│   ├── videos/{videoId}       # Embedded videos
│   ├── authors/{authorId}     # Article authors
│   └── domainMetadata/{id}    # Domain-level metadata
└── settings/{settingId}       # User preferences
```

You do not need to create these collections manually — Trails creates them on first sync.

### 5. Optional: Enable Gemini AI

Trails uses Google Gemini for AI-powered tag suggestions. To enable it:

1. In the Firebase console, go to **Build** → **AI** (or visit the [Google AI Studio](https://aistudio.google.com))
2. Enable the Gemini API for your project
3. No additional configuration is needed in the app — it uses Firebase's built-in Gemini integration

### 6. Verify

Build and run the app. On first launch you should see the sign-in screen. After signing in with Google, articles will sync to your Firestore database.

---

## Architecture

Trails follows an **offline-first MVVM** architecture with the [Tartlet](https://github.com/nicefox-io/tartlet) Store pattern for unidirectional data flow.

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  Compose UI │────▶│  ViewModel   │────▶│  Repository    │
│  (Screens)  │◀────│  (Tartlet    │◀────│  (Room + Fire- │
│             │state│   Store)     │flow │   store)       │
└─────────────┘     └──────────────┘     └────────────────┘
                                                │
                                         ┌──────┴──────┐
                                         │             │
                                    ┌────▼───┐   ┌────▼────┐
                                    │  Room  │   │Firestore│
                                    │  (Local│   │ (Cloud) │
                                    │   DB)  │   │         │
                                    └────────┘   └─────────┘
```

### Key layers

| Layer | Pattern | Key classes |
|-------|---------|-------------|
| **UI** | Jetpack Compose + Material 3 | `ArticleListScreen`, `ArticleDetailScreen` |
| **State** | Tartlet `ViewStore<State, Event>` | `ArticleListViewModel`, `TagManagementViewModel` |
| **Data** | Repository + Room + Firestore | `ArticleRepositoryImpl`, `ArticleDao` |
| **Sync** | WorkManager background jobs | `FirestoreSyncWorker`, `FirestoreRestoreWorker` |
| **DI** | Hilt | `NetworkModule`, `FirebaseModule` |
| **Content** | Unfurl | `GetArticleWithTextUseCase` |

### Project structure

```
app/src/main/java/com/jayteealao/trails/
├── common/          # Utilities, animated icons, DI
├── data/            # Repository, Room database, models
├── navigation/      # Navigation graph and scenes
├── network/         # Retrofit services, API clients
├── screens/         # UI screens (Compose)
│   ├── articleList/
│   ├── articleDetail/
│   ├── articleSearch/
│   ├── auth/
│   ├── settings/
│   ├── tagManagement/
│   └── theme/
├── services/        # Firebase, Gemini, sync
├── sync/            # WorkManager workers
├── IntentActivity.kt
└── MainActivity.kt
```

### Tech stack

| Category | Libraries |
|----------|-----------|
| UI | Jetpack Compose, Material 3, Navigation 3, Coil 3 |
| Local data | Room (FTS4 search), DataStore, Paging 3 |
| Networking | Retrofit 3, OkHttp 5 |
| Firebase | Auth, Firestore, Gemini AI |
| Background | WorkManager, Hilt Worker |
| Content extraction | Unfurl |
| Testing | JUnit 4, MockK, Coroutines Test |
| Build | Gradle 9.3.1, KSP, R8 |

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes and ensure tests pass: `./gradlew test`
4. Submit a pull request

## License

```
Copyright 2024 jayteealao

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
