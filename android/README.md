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
  <img alt="Kotlin" src="https://img.shields.io/badge/Kotlin-2.2-7F52FF?logo=kotlin&logoColor=white" />
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
| JDK | 17 |
| Gradle | 8.13 (wrapper included) |

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
| **Sync** | WorkManager background jobs | `FirestoreSyncWorker`, `SyncWorker` |
| **DI** | Hilt | `NetworkModule`, `FirebaseModule` |
| **Content** | Readability4J + Unfurl | `GetArticleWithTextUseCase` |

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
├── usecases/        # Business logic
├── IntentActivity.kt
└── MainActivity.kt
```

### Tech stack

| Category | Libraries |
|----------|-----------|
| UI | Jetpack Compose, Material 3, Navigation 3, Coil 3 |
| Local data | Room (FTS4 search), DataStore, Paging 3 |
| Networking | Retrofit 3, OkHttp 5, Ktor (Supabase) |
| Firebase | Auth, Firestore, Gemini AI |
| Background | WorkManager, Hilt Worker |
| Content extraction | Readability4J, Unfurl, Crux |
| Testing | JUnit 4, MockK, Coroutines Test |
| Build | Gradle 8.13, KSP, R8 |

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
