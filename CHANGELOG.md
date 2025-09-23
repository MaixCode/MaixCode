# Changelog

All notable changes to the "MaixCode" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2024-12-19

### Added
- **Device Discovery**: Automatic MaixCAM device discovery using mDNS
- **Device Management**: Connect, disconnect, and manage MaixCAM devices
- **Real-time Image Streaming**: Live camera feed via HTTP and WebSocket
- **MaixPy Debugging**: Integrated debugger for Python code execution
- **Example Library**: Built-in examples with Sipeed CDN integration
- **Visual Interface**: Custom sidebar panels for devices and examples
- **Command Integration**: VS Code command palette integration
- **Extension Configuration**: Basic settings for device discovery and streaming

### Features
- Auto-discovery of MaixCAM devices on local network
- Real-time image viewer with configurable refresh rates
- One-click code execution on connected devices
- Example code browser with preview functionality
- Device connection status monitoring
- Multi-format image streaming (JPEG support)
- Debug console integration for code output
- Tree view for device and example management

### Developer Features
- TypeScript-based extension architecture
- Webpack build configuration
- ESLint code quality enforcement
- VS Code API integration
- Modular service architecture
- WebSocket and HTTP client implementations

### Known Limitations
- Single device connection support
- Limited breakpoint debugging capabilities
- Basic error handling for network issues
- WebSocket stability issues in some network configurations
- No file system browser for device storage

## [Unreleased]

### Planned Features
- Enhanced debugging with breakpoints and variable inspection
- Multi-device support and device switching
- File system browser for device storage
- Performance profiling and monitoring tools
- Custom example sharing and community features
- Advanced image processing tools integration
- Improved error handling and user feedback
- Configuration UI improvements
- Theme and appearance customization

### Roadmap
- **v0.1.0**: Enhanced debugging capabilities and multi-device support
- **v0.2.0**: File system integration and advanced tooling
- **v0.3.0**: Community features and example sharing
- **v1.0.0**: Stable release with full feature set