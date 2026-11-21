package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
)

// Translation templates are edited by hand, so their key order matters: a
// translator works through the file top to bottom, and an update that
// reshuffled every key would make a diff of their own file unreadable. Go maps
// have no order, so templates are written through this small ordered model.

// kv is one member of an ordered JSON object.
type kv struct {
	Key   string
	Value any
}

// ordered is a JSON object whose members keep their insertion order.
type ordered []kv

func (o *ordered) set(key string, value any) { *o = append(*o, kv{key, value}) }

// writeJSON renders v with two-space indentation. Strings are written without
// HTML escaping: '<>' markers have to stay readable in a file people edit.
func writeJSON(v any) []byte {
	var buf bytes.Buffer
	writeValue(&buf, v, 0)
	buf.WriteByte('\n')
	return buf.Bytes()
}

func writeValue(buf *bytes.Buffer, v any, depth int) {
	indent := func(d int) {
		buf.WriteByte('\n')
		for i := 0; i < d; i++ {
			buf.WriteString("  ")
		}
	}
	switch t := v.(type) {
	case nil:
		buf.WriteString("null")
	case string:
		buf.Write(jsonString(t))
	case bool:
		buf.WriteString(strconv.FormatBool(t))
	case int:
		buf.WriteString(strconv.Itoa(t))
	case ordered:
		if len(t) == 0 {
			buf.WriteString("{}")
			return
		}
		buf.WriteByte('{')
		for i, m := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			indent(depth + 1)
			buf.Write(jsonString(m.Key))
			buf.WriteString(": ")
			writeValue(buf, m.Value, depth+1)
		}
		indent(depth)
		buf.WriteByte('}')
	case []any:
		if len(t) == 0 {
			buf.WriteString("[]")
			return
		}
		buf.WriteByte('[')
		for i, item := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			indent(depth + 1)
			writeValue(buf, item, depth+1)
		}
		indent(depth)
		buf.WriteByte(']')
	case []string:
		items := make([]any, len(t))
		for i, s := range t {
			items[i] = s
		}
		writeValue(buf, items, depth)
	case []int:
		items := make([]any, len(t))
		for i, n := range t {
			items[i] = n
		}
		writeValue(buf, items, depth)
	default:
		// Anything else is a plain value with no ordering concerns.
		var b bytes.Buffer
		enc := json.NewEncoder(&b)
		enc.SetEscapeHTML(false)
		if err := enc.Encode(t); err != nil {
			panic(fmt.Sprintf("writeJSON: %v", err))
		}
		buf.Write(bytes.TrimRight(b.Bytes(), "\n"))
	}
}

// jsonString encodes s as a JSON string without HTML escaping.
func jsonString(s string) []byte {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(s)
	return bytes.TrimRight(b.Bytes(), "\n")
}

// objectMembers returns the members of a JSON object in document order.
func objectMembers(raw []byte) ([]string, map[string]json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil {
		return nil, nil, err
	}
	if d, ok := tok.(json.Delim); !ok || d != '{' {
		return nil, nil, fmt.Errorf("expected a JSON object")
	}
	var keys []string
	values := map[string]json.RawMessage{}
	for dec.More() {
		tok, err := dec.Token()
		if err != nil {
			return nil, nil, err
		}
		key, ok := tok.(string)
		if !ok {
			return nil, nil, fmt.Errorf("expected an object key")
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, nil, err
		}
		if _, seen := values[key]; !seen {
			keys = append(keys, key)
		}
		values[key] = value
	}
	return keys, values, nil
}

// objectKeys returns the keys of a JSON object in document order, or nil when
// raw is absent or not an object.
func objectKeys(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	keys, _, err := objectMembers(raw)
	if err != nil {
		return nil
	}
	return keys
}
