package settings

import "sync"

// Store serializes writes to general settings and prompt templates.
type Store struct{ mu sync.Mutex }
