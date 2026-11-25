package com.jayteealao.trails.screens.share

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** What the share sheet shows. */
sealed interface ShareState {
    /** The shared text has no web link, so nothing is saved. */
    data object NoLink : ShareState

    data class Save(val title: String, val host: String, val phase: SavePhase) : ShareState
}

/** Saves the link that another app shared. The save itself lives in [LinkSaver] and outlives this. */
@HiltViewModel
class ShareViewModel @Inject constructor(private val linkSaver: LinkSaver) : ViewModel() {

    private val _state = MutableStateFlow<ShareState>(ShareState.NoLink)
    val state: StateFlow<ShareState> = _state.asStateFlow()

    private var started = false
    private var link: SharedLink? = null
    private var save: LinkSave? = null
    private var following: Job? = null

    /** Saves the link in [text]; only the first call does, so a rotation does not save again. */
    fun start(text: String?, title: String?) {
        if (started) return
        started = true
        link = sharedLink(text, title)
        saveLink()
    }

    fun undo() {
        save?.undo()
    }

    /** Repeats what failed: the save or its undo. */
    fun retry() {
        when (save?.state?.value?.phase) {
            SavePhase.NOT_SAVED -> saveLink()
            SavePhase.NOT_UNDONE -> undo()
            else -> Unit
        }
    }

    private fun saveLink() {
        val link = link ?: return
        val newSave = linkSaver.save(link)
        save = newSave
        _state.value = newSave.state.value.shown(link)
        following?.cancel()
        following = viewModelScope.launch {
            newSave.state.collect { _state.value = it.shown(link) }
        }
    }

    private fun LinkSaveState.shown(link: SharedLink) = ShareState.Save(title, link.host, phase)
}
