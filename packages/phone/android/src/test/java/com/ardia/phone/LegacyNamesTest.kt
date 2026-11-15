package com.ardia.phone

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test

class LegacyNamesTest {
    private val compose = generateSequence(File("").absoluteFile) { it.parentFile }.first { File(it, "apps/android").isDirectory }.resolve("apps/android")

    private fun constant(path: String, name: String): String {
        val source = compose.resolve(path).readText()
        return Regex("""const val $name = "([^"]+)"""").find(source)?.groupValues?.get(1) ?: error("$name not found in $path")
    }

    @Test
    fun theLegacyReaderOpensTheFilesTheComposeAppWrites() {
        assertEquals("the Compose app's database", constant("store/src/main/kotlin/com/ardia/store/BrowserDatabase.kt", "FILE_NAME"), PhoneLegacy.DATABASE_FILE)
        assertEquals("its browser preferences", constant("store/src/main/kotlin/com/ardia/store/BrowserStore.kt", "PREFERENCES_NAME"), PhoneLegacy.BROWSER)
        assertEquals("its blocking preferences", constant("appmodel/src/main/kotlin/com/ardia/appmodel/AppEnvironment.kt", "BLOCKING_PREFERENCES"), PhoneLegacy.BLOCKING)
        assertEquals("its reader preferences", constant("browsing/src/main/kotlin/com/ardia/browsing/ReaderView.kt", "STORE"), PhoneLegacy.READER)
    }
}
