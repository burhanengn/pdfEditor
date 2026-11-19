package dev.gullacpdf.android.ui.editor

import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import dev.gullacpdf.android.model.GpOverlayElement
import dev.gullacpdf.android.model.RichTextOps
import dev.gullacpdf.android.ui.viewport.PdfViewportController

/**
 * Invisible keyboard target for editing a text element directly on the page. The visible caret
 * and text are painted by the viewport; this field only owns IME input and the selection.
 */
@Composable
fun InlineTextKeyboardBridge(
    element: GpOverlayElement,
    controller: PdfViewportController,
    onTextChange: (GpOverlayElement) -> Unit,
) {
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val currentElement by rememberUpdatedState(element)
    var tfv by remember(element.id) {
        val idx = controller.inlineSelEnd.coerceIn(0, element.text.length)
        mutableStateOf(TextFieldValue(element.text, TextRange(idx)))
    }
    if (tfv.text != element.text) {
        val len = element.text.length
        tfv = TextFieldValue(
            element.text,
            TextRange(tfv.selection.start.coerceIn(0, len), tfv.selection.end.coerceIn(0, len)),
        )
    }

    val request = controller.inlineCaretRequest
    LaunchedEffect(request) {
        if (request != null) {
            val idx = request.first.coerceIn(0, tfv.text.length)
            tfv = tfv.copy(selection = TextRange(idx), composition = null)
            controller.inlineSelStart = idx
            controller.inlineSelEnd = idx
            focusRequester.requestFocus()
            keyboard?.show()
        }
    }
    LaunchedEffect(element.id) {
        focusRequester.requestFocus()
        keyboard?.show()
    }

    BasicTextField(
        value = tfv,
        onValueChange = { next ->
            val textChanged = next.text != tfv.text
            tfv = next
            controller.inlineSelStart = next.selection.start
            controller.inlineSelEnd = next.selection.end
            controller.caretBlinkOn = true
            if (textChanged) {
                val updated = RichTextOps.applyTextChange(currentElement, next.text)
                if (updated !== currentElement) onTextChange(updated)
            }
        },
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        modifier = Modifier
            .size(1.dp)
            .alpha(0f)
            .focusRequester(focusRequester),
    )
}
