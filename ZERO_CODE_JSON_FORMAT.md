# Zero-Code JSON Format

## Overview

When you stop recording, the system automatically generates a `test.zero.json` file in the exact format required by your Playwright zero-code engine.

## File Location

The file is saved at:
```
sample-export/{project-name}/test.zero.json
```

## Format Specification

The JSON file is an array of action objects, where each object has:
- `action`: The action type (required)
- Additional properties based on action type

## Supported Actions

### Navigation
```json
{ "action": "navigate", "url": "https://google.com" }
```

### Click Actions
```json
{ "action": "click", "selector": "#email" }
{ "action": "doubleClick", "selector": "#button" }
```

### Typing
```json
{ "action": "type", "selector": "#email", "text": "test@example.com" }
```

### Assertions

#### Assert Text
```json
{ "action": "assertText", "selector": "h1", "expected": "Dashboard" }
```

#### Assert Visible
```json
{ "action": "assertVisible", "selector": "#submit-button" }
```

#### Assert Attribute
```json
{ "action": "assertAttribute", "selector": "a", "attribute": "href", "expected": "https://example.com" }
```

#### Assert Count
```json
{ "action": "assertCount", "selector": ".item", "expected": 5 }
```

#### Assert Value
```json
{ "action": "assertValue", "selector": "#username", "expected": "admin" }
```

### Wait Actions
```json
{ "action": "waitFor", "delay": 500 }
{ "action": "waitForSelector", "selector": "#loading" }
```

### Other Actions
```json
{ "action": "screenshot", "filename": "screenshot.png" }
{ "action": "select", "selector": "#dropdown", "value": "option1" }
{ "action": "check", "selector": "#checkbox" }
{ "action": "uncheck", "selector": "#checkbox" }
{ "action": "hover", "selector": "#menu" }
{ "action": "scroll", "selector": "#container", "x": 0, "y": 100 }
{ "action": "keyPress", "key": "Enter" }
```

## Example Output

```json
[
  { "action": "navigate", "url": "https://google.com" },
  { "action": "click", "selector": "#email" },
  { "action": "type", "selector": "#email", "text": "test@example.com" },
  { "action": "assertText", "selector": "h1", "expected": "Dashboard" },
  { "action": "assertVisible", "selector": "#submit-button" }
]
```

## Integration

The zero-code JSON file is automatically generated when you:
1. Record actions
2. Add assertions (via right-click)
3. Stop recording

The file is ready to use with your Playwright zero-code engine immediately after recording stops.

## Validation

The generated JSON is validated to ensure:
- It's a valid JSON array
- Each action has an `action` property
- Required properties are present for each action type

## Notes

- Selectors use the same format as recorded (CSS selectors, XPath, text selectors)
- Assertion `expected` values are strings for text/value/attribute, numbers for count
- All actions maintain their original order from recording
- Normalized selectors are used when available for better reliability

