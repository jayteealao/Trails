package com.jayteealao.trails.data.local

/**
 * Names of the folders that hold a person's library outside the database. The code that
 * writes each folder and the "Clear data" wipe both read the name from here, so a rename
 * cannot leave a folder behind after a wipe.
 */
object LocalFolders {
    /** Downloaded archive pages, under `filesDir`. */
    const val ARCHIVES_DIR = "archives"

    /** The image loader's disk cache (article thumbnails and lead images), under `cacheDir`. */
    const val IMAGE_CACHE_DIR = "image_cache"
}
