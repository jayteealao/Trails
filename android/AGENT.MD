# Trails AI Agent Guidelines

This document provides guidelines for AI agents interacting with the Trails Android project.

## Project Overview

Trails is an Android application built with Kotlin and Jetpack Compose. It appears to be a content-focused app, potentially for reading articles and integrating with services like Pocket. The app utilizes modern Android development practices.

## Key Technologies

*   **Kotlin**: The primary programming language.
*   **Jetpack Compose**: For building the UI.
    *   Includes `androidx.compose.material3` for Material Design components.
    *   Uses `constraintlayout-compose` for complex layouts.
    *   Employs `compose-icons-cssgg` for UI icons.
*   **Android Jetpack**:
    *   ViewModel: For UI-related data and state management.
    *   LiveData/Flow: For observable data.
    *   Room: For local database persistence.
    *   Paging: For loading large datasets.
    *   Navigation: For in-app navigation.
    *   Hilt: For dependency injection (including `androidx-hilt-work`).
    *   WorkManager: For background tasks.
    *   App Startup (`androidx.startup:startup-runtime`): For initializing components at app launch.
    *   Browser (`androidx.browser:browser`): For Chrome Custom Tabs.
*   **Coroutines**: For asynchronous programming.
*   **Networking**:
    *   Retrofit & OkHttp: For type-safe HTTP calls.
    *   Ktor: As an HTTP client (e.g., `io.ktor:ktor-client-okhttp`).
    *   Supabase: For backend services (e.g., `postgrest-kt`, `realtime-kt`, `auth-kt`).
*   **Data Handling & Content**:
    *   Accompanist-WebView: For displaying web content within the app.
    *   Markdown Renderer: (`com.mikepenz:multiplatform-markdown-renderer`) For displaying markdown content.
    *   Image Loading: `landscapist-coil` (Coil-based image loading for Compose).
    *   Content Parsing: Libraries like `unfurl`, `crux`, `essence`, `readability4j` for extracting article content.
    *   Weaviate Client (`io.weaviate:client`): For interacting with a Weaviate vector database.
*   **Developer Tools**:
    *   Timber: For logging.
    *   Chucker: For HTTP inspection.
*   **Gradle**: For build automation (using Kotlin DSL and Version Catalogs).

## Architectural Patterns

*   The project likely follows an MVVM (Model-View-ViewModel) or similar architecture, with ViewModels managing UI state and interacting with data sources.
*   Dependency Injection is managed using Hilt.

## Coding Style and Conventions

*   Follow idiomatic Kotlin conventions.
*   Adhere to modern Android development best practices.
*   Ensure UI code is written using Jetpack Compose.
*   When making changes, try to maintain consistency with the existing codebase in terms of style and structure.
*   Compose functions should be restartable and skippable where possible.
*   Use `androidx` and Material 3 components.

## Important Modules/Packages

*   `com.jayteealao.trails.common`: Likely contains common utility classes, extensions, or base components used across the app.
*   `com.jayteealao.trails.data`: Contains data sources, repositories, DAOs, and database entities (e.g., `PocketArticle`).
*   `com.jayteealao.trails.network`: Likely handles network requests, API definitions, and related DTOs.
*   `com.jayteealao.trails.screens`: Contains UI composables for different screens (e.g., `articleDetail`). ViewModels are often co-located within their respective screen sub-packages.
*   `com.jayteealao.trails.services`: Contains logic for interacting with external services or background tasks (e.g., `archivebox`).
*   `com.jayteealao.trails.sync`: May contain components related to data synchronization.
*   `com.jayteealao.trails.ui`: Could contain shared UI elements, theming, or base UI components.
*   `com.jayteealao.trails.usecases`: Likely contains domain-specific business logic or interactors that orchestrate actions between ViewModels and data layers.

## Build and Dependencies

*   The project uses Gradle for managing dependencies and builds.
*   Dependencies are declared in `build.gradle.kts` files (project and app level) and potentially version catalogs (`libs.versions.toml`).
*   After adding or updating dependencies, ensure a Gradle sync is performed.

## Interacting with the Codebase

*   When asked to add new features, consider how they fit into the existing architecture.
*   For UI changes, modify or create Jetpack Compose functions.
*   For data logic changes, look into the relevant ViewModels, repositories, or service classes.
*   When resolving symbols or finding usages, provide context from the relevant files.

## Things to Avoid

*   Avoid direct Android framework calls in ViewModels where possible; use abstractions.
*   Do not introduce deprecated APIs without specific reason.
*   Ensure that any new dependencies are added correctly to the Gradle build files and are compatible with the existing ones.
*   If you modify Gradle files (`.kts`, `libs.versions.toml`, `gradle-wrapper.properties`), a Gradle Sync is likely required. You can use the `gradle_sync()` tool for this.

This document is a starting point and can be updated as the project evolves or more specific AI interaction patterns emerge.
